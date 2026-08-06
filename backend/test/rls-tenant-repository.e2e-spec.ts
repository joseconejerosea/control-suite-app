import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { TenantRepository } from '../src/common/repositories/tenant.repository';
import { Project } from '../src/modules/projects/project.entity';
import { runWithTenant } from '../src/common/tenant/tenant-context';
import { DB, ENTITIES_GLOB } from './helpers';

/**
 * Fase 2 · E4c (Gap 1) — verifica que TenantRepository, dentro de un contexto de
 * tenant, usa el QueryRunner con el GUC (manager.getRepository) → el ORM corre
 * bajo RLS. Contraste: sin contexto, el RLS esconde los datos.
 */

const ROLE = 'rls_repo_user';
const ROLE_PW = 'repo_pw';
const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();
const created: string[] = [];

describe('Fase 2 E4c — TenantRepository ruteado al contexto (Gap 1)', () => {
  let adminDs: DataSource;
  let appDs: DataSource;
  let repo: TenantRepository<Project>;

  beforeAll(async () => {
    adminDs = new DataSource({ type: 'postgres', ...DB, ssl: false, synchronize: false });
    await adminDs.initialize();

    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`);
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT, INSERT ON projects TO ${ROLE}`);
    // Estado real post-039: NULLIF + WITH CHECK.
    await adminDs.query(`DROP POLICY rls_projects_tenant_isolation ON projects`);
    await adminDs.query(`
      CREATE POLICY rls_projects_tenant_isolation ON projects
        USING (client_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (client_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
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
      entities: [ENTITIES_GLOB],
    });
    await appDs.initialize();
    repo = new TenantRepository(appDs, Project);
  });

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
      await adminDs.query(`DROP POLICY IF EXISTS rls_projects_tenant_isolation ON projects`);
      await adminDs.query(`
        CREATE POLICY rls_projects_tenant_isolation ON projects
          USING (client_id = current_setting('app.current_tenant', true)::uuid)
      `);
      const ids = [PROJECT_A, PROJECT_B, ...created];
      await adminDs.query(`DELETE FROM projects WHERE id = ANY($1)`, [ids]);
      await adminDs.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await adminDs.query(`REVOKE ALL ON projects FROM ${ROLE}`);
      await adminDs.query(`REVOKE USAGE ON SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await adminDs.destroy();
    }
  });

  it('findAll dentro de runWithTenant ve solo el tenant', async () => {
    const a = await runWithTenant(appDs, CLIENT_A, () => repo.findAll(CLIENT_A));
    expect(a.map((p) => p.name)).toEqual(['Proj A']);
    const b = await runWithTenant(appDs, CLIENT_B, () => repo.findAll(CLIENT_B));
    expect(b.map((p) => p.name)).toEqual(['Proj B']);
  });

  it('SIN contexto, el RLS esconde los datos (el ruteo es lo que los muestra)', async () => {
    const rows = await repo.findAll(CLIENT_A);
    expect(rows).toHaveLength(0);
  });

  it('create dentro de runWithTenant pasa el WITH CHECK del tenant', async () => {
    const proj = await runWithTenant(appDs, CLIENT_A, () =>
      repo.create(CLIENT_A, { name: 'Created A', status: 'active' }),
    );
    created.push(proj.id);
    const a = await runWithTenant(appDs, CLIENT_A, () => repo.findAll(CLIENT_A));
    expect(a.map((p) => p.name).sort()).toEqual(['Created A', 'Proj A']);
  });
});
