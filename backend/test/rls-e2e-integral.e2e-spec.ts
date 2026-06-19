import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { HardenRLSPolicies1700000000039 } from '../src/migrations/1700000000039-HardenRLSPolicies';
import { ExtendRLSCoverage1700000000040 } from '../src/migrations/1700000000040-ExtendRLSCoverage';
import {
  runWithTenant,
  runAsSystem,
  setSystemDataSource,
  installTenantQueryRouting,
} from '../src/common/tenant/tenant-context';
import { DB } from './helpers';

/**
 * Fase 2 · E6 — ENSAYO GENERAL (test integral). El rol de aplicación real
 * (NOBYPASSRLS, no owner, grants schema-wide) con TODAS las policies endurecidas
 * (migraciones 039 + 040) aplicadas, contra dos tenants en varias tablas.
 *
 * Es lo más cerca del switch real que se puede testear: valida que cuando
 * DB_USERNAME pase al rol sin BYPASSRLS, el aislamiento aguanta de punta a punta.
 */

const ROLE = 'rls_integral_user';
const ROLE_PW = 'integral_pw';
const A = randomUUID();
const B = randomUUID();
const PA = randomUUID();
const PB = randomUUID();
const createdProjects: string[] = [];

const names = (rows: any[], k: string) => rows.map((r) => r[k]).sort();

describe('Fase 2 E6 — ENSAYO GENERAL: rol sin BYPASSRLS + policies 039+040', () => {
  let adminDs: DataSource;
  let appDs: DataSource;
  let restore: () => void;
  const m039 = new HardenRLSPolicies1700000000039();
  const m040 = new ExtendRLSCoverage1700000000040();

  beforeAll(async () => {
    adminDs = new DataSource({ type: 'postgres', ...DB, ssl: false, synchronize: false });
    await adminDs.initialize();

    // Aplicar las migraciones de RLS endurecido (estado real de producción).
    let qr = adminDs.createQueryRunner();
    await m039.up(qr);
    await m040.up(qr);
    await qr.release();

    // Rol de aplicación real: LOGIN, NOBYPASSRLS, no owner, grants schema-wide.
    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`);
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
    await adminDs.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);

    // Seed: dos tenants en varias tablas + una equivalencia GLOBAL.
    await adminDs.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'A','active'), ($2,'B','active')`,
      [A, B],
    );
    await adminDs.query(
      `INSERT INTO projects (id, client_id, name, status) VALUES ($1,$3,'Proj A','active'), ($2,$4,'Proj B','active')`,
      [PA, PB, A, B],
    );
    await adminDs.query(
      `INSERT INTO invoices (id, client_id, vendor_name, amount, status, category) VALUES
        ($1,$3,'Vendor A',1000,'pending','cost'), ($2,$4,'Vendor B',2000,'pending','cost')`,
      [randomUUID(), randomUUID(), A, B],
    );
    await adminDs.query(
      `INSERT INTO rendiciones (id, client_id, persona_id, periodo, estado, monto_total) VALUES
        ($1,$3,$5,'2026-W20','enviada',500), ($2,$4,$6,'2026-W20','enviada',900)`,
      [randomUUID(), randomUUID(), A, B, randomUUID(), randomUUID()],
    );
    await adminDs.query(
      `INSERT INTO mind_chat_history (client_id, user_id, role, mensaje) VALUES
        ($1,$3,'user','chat A'), ($2,$4,'user','chat B')`,
      [A, B, randomUUID(), randomUUID()],
    );
    await adminDs.query(
      `INSERT INTO equivalencias_ocr_cc (client_id, keyword, categoria, destino) VALUES
        (NULL,'GLOBAL','c','gastos'), ($1,'A-only','c','gastos'), ($2,'B-only','c','gastos')`,
      [A, B],
    );

    appDs = new DataSource({
      type: 'postgres',
      host: DB.host, port: DB.port,
      username: ROLE, password: ROLE_PW, database: DB.database,
      ssl: false, synchronize: false,
    });
    await appDs.initialize();
    restore = installTenantQueryRouting(appDs);
    setSystemDataSource(adminDs); // pool de sistema (postgres tiene BYPASSRLS)
  });

  afterAll(async () => {
    restore?.();
    setSystemDataSource(undefined as any);
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
      // limpiar seeds
      await adminDs.query(`DELETE FROM projects WHERE id = ANY($1)`, [[PA, PB, ...createdProjects]]);
      await adminDs.query(`DELETE FROM invoices WHERE client_id = ANY($1)`, [[A, B]]);
      await adminDs.query(`DELETE FROM rendiciones WHERE client_id = ANY($1)`, [[A, B]]);
      await adminDs.query(`DELETE FROM mind_chat_history WHERE client_id = ANY($1)`, [[A, B]]);
      await adminDs.query(`DELETE FROM equivalencias_ocr_cc WHERE client_id = ANY($1) OR keyword='GLOBAL'`, [[A, B]]);
      await adminDs.query(`DELETE FROM clients WHERE id = ANY($1)`, [[A, B]]);
      // revertir migraciones (restaurar estado original de la DB de test)
      const qr = adminDs.createQueryRunner();
      await m040.down(qr);
      await m039.down(qr);
      await qr.release();
      // revocar y dropear rol
      await adminDs.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`REVOKE USAGE ON SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await adminDs.destroy();
    }
  });

  it('sanity: rol sin BYPASSRLS', async () => {
    const [r] = await adminDs.query(`SELECT rolbypassrls FROM pg_roles WHERE rolname=$1`, [ROLE]);
    expect(r.rolbypassrls).toBe(false);
  });

  it('aislamiento de lectura en varias tablas (tenant A)', async () => {
    await runWithTenant(appDs, A, async () => {
      const proj = await appDs.query(`SELECT name FROM projects WHERE name LIKE 'Proj%'`);
      const inv = await appDs.query(`SELECT vendor_name FROM invoices`);
      const rend = await appDs.query(`SELECT monto_total::int AS m FROM rendiciones`);
      const chat = await appDs.query(`SELECT mensaje FROM mind_chat_history WHERE mensaje LIKE 'chat%'`);
      expect(names(proj, 'name')).toEqual(['Proj A']);
      expect(names(inv, 'vendor_name')).toEqual(['Vendor A']);
      expect(rend.map((r: any) => r.m)).toEqual([500]);
      expect(names(chat, 'mensaje')).toEqual(['chat A']);
    });
  });

  it('aislamiento de lectura (tenant B)', async () => {
    await runWithTenant(appDs, B, async () => {
      const proj = await appDs.query(`SELECT name FROM projects WHERE name LIKE 'Proj%'`);
      expect(names(proj, 'name')).toEqual(['Proj B']);
    });
  });

  it('WITH CHECK: INSERT cross-tenant rechazado', async () => {
    await expect(
      runWithTenant(appDs, A, () =>
        appDs.query(
          `INSERT INTO projects (id, client_id, name, status) VALUES ($1,$2,'Sneaky','active')`,
          [randomUUID(), B],
        ),
      ),
    ).rejects.toThrow();
    const seen = await runWithTenant(appDs, B, () =>
      appDs.query(`SELECT name FROM projects WHERE name='Sneaky'`),
    );
    expect(seen).toHaveLength(0);
  });

  it('INSERT del propio tenant pasa', async () => {
    const rows = await runWithTenant(appDs, A, () =>
      appDs.query(
        `INSERT INTO projects (id, client_id, name, status) VALUES ($1,$2,'Legit A','active') RETURNING id`,
        [randomUUID(), A],
      ),
    );
    createdProjects.push(rows[0].id);
    const seen = await runWithTenant(appDs, A, () =>
      appDs.query(`SELECT name FROM projects WHERE name='Legit A'`),
    );
    expect(seen).toHaveLength(1);
  });

  it('equivalencias: globales visibles + propias, no ajenas', async () => {
    const a = await runWithTenant(appDs, A, () => appDs.query(`SELECT keyword FROM equivalencias_ocr_cc`));
    expect(names(a, 'keyword')).toEqual(['A-only', 'GLOBAL']);
  });

  it('runAsSystem ve todos los tenants (cross-tenant)', async () => {
    const proj = await runAsSystem(() => appDs.query(`SELECT name FROM projects WHERE name LIKE 'Proj%'`));
    expect(names(proj, 'name')).toEqual(['Proj A', 'Proj B']);
  });

  it('sin contexto, el rol no ve nada y NO explota (NULLIF)', async () => {
    const rows = await appDs.query(`SELECT name FROM projects WHERE name LIKE 'Proj%'`);
    expect(rows).toHaveLength(0);
  });
});
