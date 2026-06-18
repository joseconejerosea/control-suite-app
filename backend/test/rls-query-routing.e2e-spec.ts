import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { runWithTenant, installTenantQueryRouting } from '../src/common/tenant/tenant-context';
import { DB } from './helpers';

/**
 * Fase 2 · E4b — verifica el monkey-patch installTenantQueryRouting sobre el
 * DataSource REAL (rol sin BYPASSRLS). Clave: las queries usan `appDs.query`
 * DIRECTO (sin proxy), como hacen los ~511 ds.query de la app. El patch debe
 * rutearlas al QueryRunner con el GUC seteado.
 */

const ROLE = 'rls_routing_user';
const ROLE_PW = 'routing_pw';
const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();
const Q = `SELECT name FROM projects WHERE name IN ('Proj A','Proj B') ORDER BY name`;

describe('Fase 2 E4b — installTenantQueryRouting (monkey-patch del DataSource)', () => {
  let adminDs: DataSource;
  let appDs: DataSource;
  let restore: () => void;

  beforeAll(async () => {
    adminDs = new DataSource({ type: 'postgres', ...DB, ssl: false, synchronize: false });
    await adminDs.initialize();

    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`);
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT ON projects TO ${ROLE}`);
    // Replicar el estado real (post-039): policy de projects con NULLIF, para que
    // una conexión reusada con app.current_tenant='' filtre a 0 filas y no explote.
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
  });

  afterAll(async () => {
    restore?.();
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
      // Restaurar la policy original de projects (sin NULLIF).
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

  it('con el patch, appDs.query DIRECTO dentro de runWithTenant rutea y aísla', async () => {
    const a = await runWithTenant(appDs, CLIENT_A, () => appDs.query(Q));
    expect(a.map((r: any) => r.name)).toEqual(['Proj A']);
    const b = await runWithTenant(appDs, CLIENT_B, () => appDs.query(Q));
    expect(b.map((r: any) => r.name)).toEqual(['Proj B']);
  });

  it('fuera de contexto, appDs.query directo no ve filas (RLS muerde)', async () => {
    const rows = await appDs.query(Q);
    expect(rows).toHaveLength(0);
  });

  it('es idempotente: reinstalar no rompe el ruteo', async () => {
    installTenantQueryRouting(appDs);
    const a = await runWithTenant(appDs, CLIENT_A, () => appDs.query(Q));
    expect(a.map((r: any) => r.name)).toEqual(['Proj A']);
  });

  it('SIN el patch, el query directo NO trae los datos del tenant (no rutea) — prueba del valor del patch', async () => {
    restore(); // quitar patch
    // Sin ruteo, appDs.query va a otra conexión del pool sin el GUC del runner:
    // o devuelve 0 filas, o lanza (conexión reusada con app.current_tenant='').
    // En ningún caso ve los datos de A. Ambos prueban que NO ruteó.
    let leaked = false;
    try {
      const rows = await runWithTenant(appDs, CLIENT_A, () => appDs.query(Q));
      leaked = rows.some((r: any) => r.name === 'Proj A');
    } catch {
      leaked = false;
    }
    expect(leaked).toBe(false);
    restore = installTenantQueryRouting(appDs); // reinstalar para afterAll
  });
});
