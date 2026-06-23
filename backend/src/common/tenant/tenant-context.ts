import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';

/**
 * Contexto de tenant para el backstop RLS (Fase 2).
 *
 * El problema: ~511 `ds.query(...)` raw agarran una conexión arbitraria del pool.
 * `app.current_tenant` (el GUC que las policies RLS leen) es transaction/connection
 * scoped — si se setea en una conexión y la query sale por otra, no aísla.
 *
 * La solución: por cada unidad de trabajo (request HTTP o job), abrir UNA
 * transacción con `app.current_tenant` seteado en un QueryRunner dedicado, y
 * guardarlo en AsyncLocalStorage. Un Proxy sobre el DataSource rutea `.query()`
 * a ese QueryRunner, sin tocar las llamadas existentes.
 */

export interface TenantStore {
  queryRunner: QueryRunner;
  clientId: string;
  /** true cuando el contexto es de sistema (cross-tenant, pool con BYPASSRLS). */
  system?: boolean;
}

const storage = new AsyncLocalStorage<TenantStore>();

// DataSource de sistema (rol con BYPASSRLS) para operaciones cross-tenant
// legítimas. Se setea en bootstrap (main.ts) vía setSystemDataSource.
let systemDataSource: DataSource | null = null;

/** Registra el DataSource de sistema (pool con BYPASSRLS) usado por runAsSystem. */
export function setSystemDataSource(ds: DataSource): void {
  systemDataSource = ds;
}

/** Contexto de tenant de la unidad de trabajo actual, si la hay. */
export function getTenantStore(): TenantStore | undefined {
  return storage.getStore();
}

/**
 * EntityManager ligado a la unidad de trabajo actual: el del QueryRunner con el
 * GUC (dentro de runWithTenant/runAsSystem) o el del DataSource (fuera). Para
 * `getRepository` directos que deben correr bajo RLS sin convertir a ds.query.
 */
export function tenantManager(ds: DataSource): EntityManager {
  return storage.getStore()?.queryRunner.manager ?? ds.manager;
}

/**
 * Ejecuta `fn` dentro de una transacción con `app.current_tenant = clientId`,
 * sobre un QueryRunner dedicado accesible vía AsyncLocalStorage.
 * - Commit si `fn` resuelve; rollback si lanza.
 * - El GUC se setea con `set_config(..., is_local=true)`: scoped a ESTA
 *   transacción y parametrizado (el uuid no se interpola en el SQL).
 */
export async function runWithTenant<T>(
  ds: DataSource,
  clientId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const queryRunner = ds.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [clientId]);
    const result = await storage.run({ queryRunner, clientId }, fn);
    await queryRunner.commitTransaction();
    return result;
  } catch (err) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw err;
  } finally {
    await queryRunner.release();
  }
}

/**
 * Ejecuta `fn` con acceso CROSS-TENANT, sobre el DataSource de sistema (rol con
 * BYPASSRLS). Para operaciones legítimamente globales: descubrimiento en webhooks
 * (resolver canal_entrada antes de conocer el tenant), barridas de crons,
 * expiraciones. Los `ds.query` dentro de `fn` rutean (vía el patch + ALS) al pool
 * de sistema. NO abre transacción ni setea tenant: el rol bypassa RLS.
 *
 * Usar con criterio: es el único camino que ve todos los tenants. Todo lo que
 * sea por-tenant debe ir por runWithTenant.
 */
export async function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  if (!systemDataSource) {
    throw new Error('runAsSystem: DataSource de sistema no inicializado (setSystemDataSource)');
  }
  const queryRunner = systemDataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    return await storage.run({ queryRunner, clientId: '__system__', system: true }, fn);
  } finally {
    await queryRunner.release();
  }
}

/**
 * Envuelve un DataSource en un Proxy que rutea `.query()` al QueryRunner del
 * contexto de tenant activo. Las llamadas `ds.query(...)` existentes corren así
 * en la conexión con el GUC seteado, sin modificarlas. Fuera de un contexto de
 * tenant (arranque, migraciones, tareas sin tenant) cae al DataSource normal.
 */
export function makeTenantAwareDataSource(ds: DataSource): DataSource {
  return new Proxy(ds, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (query: string, parameters?: any[]) => {
          const store = storage.getStore();
          return store
            ? store.queryRunner.query(query, parameters)
            : target.query(query, parameters);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const ROUTING_FLAG = Symbol.for('control-suite.tenantQueryRouting');

/**
 * Instala el ruteo tenant sobre el DataSource real mutando su método `.query`:
 * dentro de un contexto de tenant (ALS) rutea al QueryRunner con el GUC seteado;
 * fuera, llama al `.query` original. Así los ~511 `ds.query(...)` ya inyectados
 * quedan tenant-aware sin tocar la inyección de dependencias de TypeORM.
 *
 * Elegido sobre un override de DI por ser predecible y verificable (el harness
 * e2e no levanta AppModule). Idempotente. Devuelve una función para revertir
 * (usada en tests). Si la llamada pasa un QueryRunner explícito (3er arg), se
 * respeta y NO se rutea — preserva las transacciones manuales existentes.
 */
export function installTenantQueryRouting(ds: DataSource): () => void {
  const anyDs = ds as any;
  if (anyDs[ROUTING_FLAG]) return anyDs[ROUTING_FLAG];

  const original = ds.query.bind(ds);
  anyDs.query = function (this: unknown, ...args: any[]) {
    const store = storage.getStore();
    if (store && args.length <= 2) {
      return store.queryRunner.query(args[0], args[1]);
    }
    return (original as any)(...args);
  };

  const restore = () => {
    anyDs.query = original;
    delete anyDs[ROUTING_FLAG];
  };
  anyDs[ROUTING_FLAG] = restore;
  return restore;
}
