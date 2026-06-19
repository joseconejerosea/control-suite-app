# Guía de testing — control-suite (backend)

Cómo están armados los tests, cómo correrlos y cómo escribir nuevos. Todo el
testing es **e2e contra una base PostgreSQL efímera local** — nunca toca prod.

---

## TL;DR — correr los tests

```bash
# 1) Arrancar el cluster de test (si no está corriendo)
PGDATA=/c/Users/User/AppData/Local/Temp/cs-pgtest
pg_ctl -D "$PGDATA" -o "-p 5433" -l "$PGDATA/server.log" start

# 2) Correr (desde backend/). El --runInBand es OBLIGATORIO (DB compartida, serial).
cd backend
DB_HOST=127.0.0.1 DB_PORT=5433 DB_USERNAME=postgres DB_PASSWORD= DB_NAME=controlsuite_test NODE_ENV=test \
  npx jest --config ./test/jest-e2e.json --runInBand

# Filtrar por suite (substring del nombre de archivo):
#   ... --runInBand tenant-isolation
#   ... --runInBand rls-
#   ... --runInBand rls-e2e-integral
```

> **Estado esperado:** 15/16 suites verde. El único rojo es `app.e2e-spec.ts`,
> **pre-existente** y NO relacionado: levanta el `AppModule` completo y el
> `ConfigModule`/Joi exige el `.env` entero (p.ej. `DB_PASSWORD` no vacío). No es
> una regresión; las suites de aislamiento no dependen de él.

---

## La base de datos de test

- Cluster **PostgreSQL 17 efímero**, separado del de desarrollo: `127.0.0.1:5433`,
  base `controlsuite_test`, data dir `/c/Users/User/AppData/Local/Temp/cs-pgtest`.
- Auth `trust` (`initdb -A trust`) → no hace falta password para `postgres`.
- Tiene **todas las migraciones corridas** (incluido el RLS). Los roles de
  aplicación los crea cada test RLS en su `beforeAll` y los dropea en `afterAll`.

**Si el cluster no existe (recrear de cero):**

```bash
PGDATA=/c/Users/User/AppData/Local/Temp/cs-pgtest
initdb -D "$PGDATA" -U postgres -A trust
pg_ctl -D "$PGDATA" -o "-p 5433" -l "$PGDATA/server.log" start
psql -h 127.0.0.1 -p 5433 -U postgres -c "CREATE DATABASE controlsuite_test"
# stub que algunas migraciones esperan (storage de Supabase):
psql -h 127.0.0.1 -p 5433 -U postgres -d controlsuite_test \
  -c "CREATE SCHEMA IF NOT EXISTS storage; CREATE TABLE IF NOT EXISTS storage.buckets (id text primary key)"
# correr migraciones contra la DB de test:
cd backend
DB_HOST=127.0.0.1 DB_PORT=5433 DB_USERNAME=postgres DB_PASSWORD= DB_NAME=controlsuite_test \
  npm run migration:run
```

---

## Config

- `test/jest-e2e.json` — `testRegex: .e2e-spec.ts$`, transform con `ts-jest`.
- `test/helpers.ts` — scaffolding compartido:
  - `DB` — credenciales del cluster de test (leídas de env con defaults a `:5433`).
  - `ENTITIES_GLOB` — glob de entidades (para `TypeOrmModule`/`new DataSource` con ORM).
  - `tokenFor(clientId, role?)` — firma un JWT con el **shape real** (solo
    `client_id` snake_case), `HS256`.
  - `JWT_SECRET`, `configServiceProvider` — para `AuthGuard` en tests HTTP.

---

## Dos familias de tests

### 1. `tenant-isolation-*` — Capa 1 (filtros app-level)

Verifican que un **servicio** filtra por el `client_id` del JWT (sin depender de
RLS). Patrón: levantar el módulo con `Test.createTestingModule` + `TypeOrmModule`,
sembrar dos tenants, llamar al método del servicio directo y asertar aislamiento.

```ts
const moduleRef = await Test.createTestingModule({
  imports: [TypeOrmModule.forRoot({ type: 'postgres', ...DB, ssl: false,
    synchronize: false, entities: [ENTITIES_GLOB] })],
  providers: [MiServicio],
}).compile();
const service = moduleRef.get(MiServicio);
// service como rol postgres (con BYPASSRLS) → prueba el filtro APP-LEVEL, no RLS.
await expect((service as any).metodo(CLIENT_A, RECURSO_DE_B)).rejects.toBeInstanceOf(NotFoundException);
```

### 2. `rls-*` — Capa 2 (RLS a nivel motor)

Verifican el aislamiento del **motor** con un rol **sin `BYPASSRLS`** (el rol que
correrá en prod tras el switch). Usan el binding de `src/common/tenant/tenant-context.ts`:
`runWithTenant` (por-tenant), `runAsSystem` (cross-tenant, pool de sistema),
`installTenantQueryRouting` (monkey-patch del `ds.query`), `tenantManager`/`TenantRepository`.

Esqueleto típico:

```ts
let adminDs: DataSource;  // postgres (BYPASSRLS) — setup/seed/teardown y pool de sistema
let appDs: DataSource;    // rol sin BYPASSRLS — el que se prueba

beforeAll(async () => {
  adminDs = new DataSource({ type:'postgres', ...DB, ssl:false, synchronize:false });
  await adminDs.initialize();

  // rol de aplicación real
  await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await adminDs.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PW}' NOBYPASSRLS`);
  await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await adminDs.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON <tablas> TO ${ROLE}`);

  // seed con adminDs (bypassa RLS) ...

  appDs = new DataSource({ type:'postgres', host:DB.host, port:DB.port,
    username:ROLE, password:PW, database:DB.database, ssl:false, synchronize:false });
  await appDs.initialize();
  installTenantQueryRouting(appDs);     // si se usan ds.query directos
  setSystemDataSource(adminDs);         // si se usa runAsSystem
});

afterAll(async () => {
  await appDs.destroy();
  // limpiar seeds, REVOKE, DROP ROLE, restaurar policies tocadas, adminDs.destroy()
});

it('aisla', async () => {
  const rows = await runWithTenant(appDs, CLIENT_A, () => appDs.query(Q)); // solo datos de A
});
```

Para correr **migraciones reales** dentro de un test (como `rls-e2e-integral`):
`const qr = adminDs.createQueryRunner(); await new MiMigracion().up(qr); await qr.release();`
(y `down()` en `afterAll`).

---

## Gotchas (te van a morder si no los sabés)

- **`--runInBand` siempre.** La DB es compartida; en paralelo los tests se pisan.
- **`''::uuid` explota.** Tras una tx, el GUC `app.current_tenant` vuelve a `''`
  (no NULL) en la conexión del pool. Las policies usan `NULLIF(...,'')` para
  filtrar a 0 filas en vez de tirar error. Si tu test reusa una conexión (o pool
  `extra:{max:1}`), aplicá la policy con `NULLIF` en el `beforeAll` y restaurala
  en `afterAll` (ver `rls-poc`/`rls-query-routing`).
- **El monkey-patch cubre `ds.query`, NO los repos.** Para repos usá
  `TenantRepository` o `tenantManager(ds).getRepository(...)` (ruteados al contexto).
- **Limpieza obligatoria** en `afterAll`: borrar seeds, `REVOKE`/`DROP ROLE`,
  restaurar cualquier policy modificada. La DB de test persiste entre corridas.
- **`runAsSystem` necesita `setSystemDataSource(...)`** o lanza. En tests, el pool
  de sistema es `adminDs` (postgres tiene BYPASSRLS).

---

## Disciplina: RED → GREEN (regla del proyecto)

Todo fix request-reachable se prueba **rompiéndolo primero**:
1. Escribí el test y verificá que pasa (GREEN).
2. **Rompé** el fix a propósito (sacá el `client_id`, el `NULLIF`, la policy) y
   confirmá que el test **falla** (RED).
3. **Restaurá** el fix y confirmá GREEN de nuevo.

Un test que nunca viste fallar no prueba nada. Para defensa-en-profundidad / cosas
no request-reachable, decílo explícito: "verificado por revisión, NO por test".

---

## Checklist para un test nuevo (útil para los próximos hallazgos)

- [ ] ¿Capa 1 (filtro app-level) o Capa 2 (RLS)? Elegí la familia y el patrón.
- [ ] Sembrar **dos tenants** (A y B) con marcadores distinguibles.
- [ ] Probar: A ve lo de A, A NO ve lo de B, (escritura) WITH CHECK rechaza cross-tenant.
- [ ] `afterAll` que limpia TODO (seeds, rol, policies).
- [ ] RED→GREEN: romper el fix y ver el test caer.
- [ ] Correr la **suite completa** al final → cero regresión (15/16, el rojo es `app.e2e-spec`).
```
