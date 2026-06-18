import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { HardenRLSPolicies1700000000039 } from '../src/migrations/1700000000039-HardenRLSPolicies';
import { runWithTenant, makeTenantAwareDataSource } from '../src/common/tenant/tenant-context';
import { DB } from './helpers';

/**
 * Fase 2 · paso 1 — verifica la migración HardenRLSPolicies contra el rol real
 * sin BYPASSRLS. Corre la migración REAL (up/down), no una copia.
 *
 * Garantías nuevas:
 *  - NULLIF: sin contexto de tenant → 0 filas (no error de casteo ''::uuid).
 *  - WITH CHECK: INSERT/UPDATE que muevan una fila a otro tenant → rechazados.
 */

const ROLE = 'rls_harden_user';
const ROLE_PW = 'harden_pw';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PROJECT_A = randomUUID();

const namesFor = (rows: any[]) => rows.map((r) => r.name).sort();

describe('Fase 2 paso 1 — HardenRLSPolicies (NULLIF + WITH CHECK)', () => {
  let adminDs: DataSource;
  let appDs: DataSource;
  const proxyOf = (ds: DataSource) => makeTenantAwareDataSource(ds);

  beforeAll(async () => {
    adminDs = new DataSource({ type: 'postgres', ...DB, ssl: false, synchronize: false });
    await adminDs.initialize();

    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`);
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT, INSERT, UPDATE ON projects TO ${ROLE}`);

    await adminDs.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await adminDs.query(
      `INSERT INTO projects (id, client_id, name, status) VALUES ($1,$2,'Proj A','active')`,
      [PROJECT_A, CLIENT_A],
    );

    // Aplicar la migración REAL.
    const qr = adminDs.createQueryRunner();
    await new HardenRLSPolicies1700000000039().up(qr);
    await qr.release();

    appDs = new DataSource({
      type: 'postgres',
      host: DB.host,
      port: DB.port,
      username: ROLE,
      password: ROLE_PW,
      database: DB.database,
      ssl: false,
      synchronize: false,
      // Pool de 1 conexión: hace DETERMINÍSTICO el escenario de conexión reusada
      // (el GUC custom vuelve a '' tras una tx) para validar el NULLIF.
      extra: { max: 1 },
    });
    await appDs.initialize();
  });

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
      // Revertir la migración (restaura policies originales solo-USING).
      const qr = adminDs.createQueryRunner();
      await new HardenRLSPolicies1700000000039().down(qr);
      await qr.release();

      await adminDs.query(`DELETE FROM projects WHERE client_id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await adminDs.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await adminDs.query(`REVOKE ALL ON projects FROM ${ROLE}`);
      await adminDs.query(`REVOKE USAGE ON SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await adminDs.destroy();
    }
  });

  // ── NULLIF: robustez fuera de contexto ──
  it('sin contexto de tenant devuelve 0 filas SIN error de casteo (NULLIF)', async () => {
    const proxy = proxyOf(appDs);
    const rows = await proxy.query(`SELECT name FROM projects WHERE name = 'Proj A'`);
    expect(rows).toHaveLength(0);
  });

  // ── NULLIF: el caso que importa — conexión REUSADA tras una unidad de trabajo ──
  it('tras un runWithTenant, una query sin contexto en la MISMA conexion da 0 filas (no error de casteo vacio a uuid)', async () => {
    const proxy = proxyOf(appDs);
    // Deja el GUC en '' sobre la (única) conexión del pool.
    await runWithTenant(appDs, CLIENT_A, () =>
      proxy.query(`SELECT name FROM projects WHERE name = 'Proj A'`),
    );
    // Sin NULLIF, esto lanzaría: sintaxis inválida para uuid «».
    const rows = await proxy.query(`SELECT name FROM projects WHERE name = 'Proj A'`);
    expect(rows).toHaveLength(0);
  });

  // ── USING sigue aislando lectura ──
  it('runWithTenant(A) lee solo filas de A', async () => {
    const proxy = proxyOf(appDs);
    const rows = await runWithTenant(appDs, CLIENT_A, () =>
      proxy.query(`SELECT name FROM projects WHERE name = 'Proj A'`),
    );
    expect(namesFor(rows)).toEqual(['Proj A']);
  });

  // ── WITH CHECK: INSERT del propio tenant pasa ──
  it('runWithTenant(A) permite INSERT con client_id propio', async () => {
    const proxy = proxyOf(appDs);
    await runWithTenant(appDs, CLIENT_A, () =>
      proxy.query(
        `INSERT INTO projects (id, client_id, name, status) VALUES ($1,$2,'Legit A','active')`,
        [randomUUID(), CLIENT_A],
      ),
    );
    const rows = await runWithTenant(appDs, CLIENT_A, () =>
      proxy.query(`SELECT name FROM projects WHERE name IN ('Proj A','Legit A')`),
    );
    expect(namesFor(rows)).toEqual(['Legit A', 'Proj A']);
  });

  // ── WITH CHECK: INSERT cross-tenant rechazado ──
  it('runWithTenant(A) RECHAZA INSERT con client_id ajeno (WITH CHECK)', async () => {
    const proxy = proxyOf(appDs);
    await expect(
      runWithTenant(appDs, CLIENT_A, () =>
        proxy.query(
          `INSERT INTO projects (id, client_id, name, status) VALUES ($1,$2,'Sneaky B','active')`,
          [randomUUID(), CLIENT_B],
        ),
      ),
    ).rejects.toThrow();

    // La fila no existe para NINGÚN tenant.
    const seenByB = await runWithTenant(appDs, CLIENT_B, () =>
      proxy.query(`SELECT name FROM projects WHERE name = 'Sneaky B'`),
    );
    expect(seenByB).toHaveLength(0);
  });

  // ── WITH CHECK: UPDATE que mueve la fila a otro tenant rechazado ──
  it('runWithTenant(A) RECHAZA UPDATE que reasigna client_id a otro tenant', async () => {
    const proxy = proxyOf(appDs);
    await expect(
      runWithTenant(appDs, CLIENT_A, () =>
        proxy.query(`UPDATE projects SET client_id = $1 WHERE id = $2`, [CLIENT_B, PROJECT_A]),
      ),
    ).rejects.toThrow();

    // Proj A sigue perteneciendo a A.
    const stillA = await runWithTenant(appDs, CLIENT_A, () =>
      proxy.query(`SELECT name FROM projects WHERE id = $1`, [PROJECT_A]),
    );
    expect(namesFor(stillA)).toEqual(['Proj A']);
  });
});
