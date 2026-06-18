import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { runWithTenant, makeTenantAwareDataSource } from '../src/common/tenant/tenant-context';
import { DB } from './helpers';

/**
 * Fase 2 — PoC del backstop RLS.
 *
 * Prueba el CIMIENTO antes de escalar a los ~511 ds.query: que con un rol SIN
 * BYPASSRLS + `app.current_tenant` seteado vía runWithTenant + ruteo por el
 * Proxy, una query SIN `WHERE client_id` queda aislada por el motor.
 *
 * - adminDs (postgres): setup/seed/teardown.
 * - appDs  (rls_poc_user, NOBYPASSRLS, no owner): el rol de aplicación real.
 */

const ROLE = 'rls_poc_user';
const ROLE_PW = 'poc_pw';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();

const SELECT_PROJECTS = `SELECT name FROM projects WHERE name IN ('Proj A','Proj B') ORDER BY name`;

describe('Fase 2 PoC — RLS con rol sin BYPASSRLS + SET LOCAL vía ALS', () => {
  let adminDs: DataSource;
  let appDs: DataSource;

  beforeAll(async () => {
    adminDs = new DataSource({ type: 'postgres', ...DB, ssl: false, synchronize: false });
    await adminDs.initialize();

    // Rol de aplicación dedicado: LOGIN, NOBYPASSRLS, no owner de las tablas.
    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`);
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT ON projects TO ${ROLE}`);

    // HALLAZGO del PoC: la policy original castea `current_setting(...)::uuid`
    // directo. Tras una tx, el GUC custom vuelve a '' (no NULL) en la conexión
    // del pool → `''::uuid` LANZA error en vez de devolver 0 filas. Fase 2 debe
    // recrear las 22 policies con NULLIF(..., ''). Acá aplicamos el fix a projects
    // para validar el mecanismo contra la policy ROBUSTA (restaurado en afterAll).
    await adminDs.query(`DROP POLICY rls_projects_tenant_isolation ON projects`);
    await adminDs.query(`
      CREATE POLICY rls_projects_tenant_isolation ON projects
        USING (client_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `);

    // Seed: dos tenants.
    await adminDs.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await adminDs.query(
      `INSERT INTO projects (id, client_id, name, status) VALUES
        ($1,$3,'Proj A','active'), ($2,$4,'Proj B','active')`,
      [PROJECT_A, PROJECT_B, CLIENT_A, CLIENT_B],
    );

    appDs = new DataSource({
      type: 'postgres',
      host: DB.host,
      port: DB.port,
      username: ROLE,
      password: ROLE_PW,
      database: DB.database,
      ssl: false,
      synchronize: false,
    });
    await appDs.initialize();
  });

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
      // Restaurar la policy original (sin NULLIF) para no alterar la DB de test.
      await adminDs.query(`DROP POLICY IF EXISTS rls_projects_tenant_isolation ON projects`);
      await adminDs.query(`
        CREATE POLICY rls_projects_tenant_isolation ON projects
          USING (client_id = current_setting('app.current_tenant', true)::uuid)
      `);
      await adminDs.query(`DELETE FROM projects WHERE id = ANY($1)`, [[PROJECT_A, PROJECT_B]]);
      await adminDs.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await adminDs.query(`REVOKE ALL ON projects FROM ${ROLE}`);
      await adminDs.query(`REVOKE USAGE ON SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await adminDs.destroy();
    }
  });

  it('sanity: el rol de app NO tiene BYPASSRLS', async () => {
    const [row] = await adminDs.query(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [ROLE],
    );
    expect(row.rolbypassrls).toBe(false);
  });

  it('sin contexto de tenant, el rol no ve NINGUNA fila (RLS muerde)', async () => {
    const proxy = makeTenantAwareDataSource(appDs);
    const rows = await proxy.query(SELECT_PROJECTS);
    expect(rows).toHaveLength(0);
  });

  it('runWithTenant(A) ve SOLO las filas de A — sin WHERE client_id en la query', async () => {
    const proxy = makeTenantAwareDataSource(appDs);
    const rows = await runWithTenant(appDs, CLIENT_A, () => proxy.query(SELECT_PROJECTS));
    expect(rows.map((r: any) => r.name)).toEqual(['Proj A']);
  });

  it('runWithTenant(B) ve SOLO las filas de B', async () => {
    const proxy = makeTenantAwareDataSource(appDs);
    const rows = await runWithTenant(appDs, CLIENT_B, () => proxy.query(SELECT_PROJECTS));
    expect(rows.map((r: any) => r.name)).toEqual(['Proj B']);
  });

  it('el GUC NO se filtra entre unidades de trabajo (se libera al cerrar la tx)', async () => {
    const proxy = makeTenantAwareDataSource(appDs);
    await runWithTenant(appDs, CLIENT_A, () => proxy.query(SELECT_PROJECTS));
    // Fuera del contexto, vuelve a 0 filas: el SET LOCAL no sobrevive la tx.
    const rows = await proxy.query(SELECT_PROJECTS);
    expect(rows).toHaveLength(0);
  });
});
