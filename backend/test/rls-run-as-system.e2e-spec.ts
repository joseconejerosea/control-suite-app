import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import {
  runWithTenant,
  runAsSystem,
  setSystemDataSource,
  installTenantQueryRouting,
} from '../src/common/tenant/tenant-context';
import { DB } from './helpers';

/**
 * Fase 2 · E4c (Gap 3) — verifica runAsSystem: acceso cross-tenant vía el pool
 * de sistema (rol con BYPASSRLS), conviviendo con runWithTenant (aislado).
 *
 * Clave: las queries usan appDs.query DIRECTO (rol sin BYPASSRLS). Dentro de
 * runAsSystem deben rutear al pool de sistema y ver TODOS los tenants; dentro de
 * runWithTenant, solo el tenant; fuera, nada.
 */

const ROLE = 'rls_system_user';
const ROLE_PW = 'system_pw';
const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();
const Q = `SELECT name FROM projects WHERE name IN ('Proj A','Proj B') ORDER BY name`;

describe('Fase 2 E4c — runAsSystem (pool de sistema BYPASSRLS)', () => {
  let adminDs: DataSource; // postgres — también hace de pool de sistema (BYPASSRLS)
  let appDs: DataSource;   // rol sin BYPASSRLS (pool normal)
  let restore: () => void;

  beforeAll(async () => {
    adminDs = new DataSource({ type: 'postgres', ...DB, ssl: false, synchronize: false });
    await adminDs.initialize();

    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`);
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT ON projects TO ${ROLE}`);
    // Estado real post-039: policy con NULLIF.
    await adminDs.query(`DROP POLICY rls_projects_tenant_isolation ON projects`);
    await adminDs.query(`
      CREATE POLICY rls_projects_tenant_isolation ON projects
        USING (client_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `);
    await adminDs.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'A','active'), ($2,'B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await adminDs.query(
      `INSERT INTO projects (id, client_id, name, status) VALUES ($1,$3,'Proj A','active'), ($2,$4,'Proj B','active')`,
      [PROJECT_A, PROJECT_B, CLIENT_A, CLIENT_B],
    );

    appDs = new DataSource({
      type: 'postgres',
      host: DB.host, port: DB.port,
      username: ROLE, password: ROLE_PW, database: DB.database,
      ssl: false, synchronize: false,
    });
    await appDs.initialize();
    restore = installTenantQueryRouting(appDs);
    // El "pool de sistema" en el test es adminDs (postgres tiene BYPASSRLS).
    setSystemDataSource(adminDs);
  });

  afterAll(async () => {
    restore?.();
    setSystemDataSource(undefined as any);
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
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

  it('runAsSystem ve TODOS los tenants (cross-tenant vía pool BYPASSRLS)', async () => {
    const rows = await runAsSystem(() => appDs.query(Q));
    expect(rows.map((r: any) => r.name)).toEqual(['Proj A', 'Proj B']);
  });

  it('runWithTenant sigue aislando (convive con runAsSystem)', async () => {
    const a = await runWithTenant(appDs, CLIENT_A, () => appDs.query(Q));
    expect(a.map((r: any) => r.name)).toEqual(['Proj A']);
  });

  it('fuera de todo contexto, el rol sin BYPASSRLS no ve nada', async () => {
    const rows = await appDs.query(Q);
    expect(rows).toHaveLength(0);
  });

  it('runAsSystem lanza si no hay DataSource de sistema configurado', async () => {
    setSystemDataSource(undefined as any);
    await expect(runAsSystem(() => appDs.query(Q))).rejects.toThrow(/sistema/i);
    setSystemDataSource(adminDs); // restaurar para afterAll
  });
});
