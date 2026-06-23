import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { ExtendRLSCoverage1700000000040 } from '../src/migrations/1700000000040-ExtendRLSCoverage';
import { runWithTenant, makeTenantAwareDataSource } from '../src/common/tenant/tenant-context';
import { DB } from './helpers';

/**
 * Fase 2 · E3 (plan 2.2) — verifica ExtendRLSCoverage contra rol sin BYPASSRLS.
 * Corre la migración REAL (up/down). Cubre los tres patrones de cobertura:
 *   - Grupo A estándar (mind_chat_history): aislamiento + WITH CHECK.
 *   - equivalencias_ocr_cc: globales (NULL) visibles a todos; no se pueden crear.
 *   - f1_reprocess_log: aislamiento por subquery a eventos_crudos (sin client_id).
 */

const ROLE = 'rls_extend_user';
const ROLE_PW = 'extend_pw';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const EV_A = randomUUID();
const EV_B = randomUUID();

const sorted = (rows: any[], k: string) => rows.map((r) => r[k]).sort();

describe('Fase 2 E3 — ExtendRLSCoverage (estándar + globales + subquery)', () => {
  let adminDs: DataSource;
  let appDs: DataSource;
  const proxy = () => makeTenantAwareDataSource(appDs);

  beforeAll(async () => {
    adminDs = new DataSource({ type: 'postgres', ...DB, ssl: false, synchronize: false });
    await adminDs.initialize();

    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`);
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT, INSERT ON mind_chat_history, equivalencias_ocr_cc TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT ON f1_reprocess_log, eventos_crudos TO ${ROLE}`);

    await adminDs.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'A','active'), ($2,'B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    // Grupo A
    await adminDs.query(
      `INSERT INTO mind_chat_history (client_id, user_id, role, mensaje) VALUES
        ($1,$3,'user','chat A'), ($2,$4,'user','chat B')`,
      [CLIENT_A, CLIENT_B, randomUUID(), randomUUID()],
    );
    // equivalencias: una global (NULL) + una por tenant
    await adminDs.query(
      `INSERT INTO equivalencias_ocr_cc (client_id, keyword, categoria, destino) VALUES
        (NULL,'GLOBAL','c','gastos'), ($1,'A-only','c','gastos'), ($2,'B-only','c','gastos')`,
      [CLIENT_A, CLIENT_B],
    );
    // eventos + sus reprocess logs (f1_reprocess_log no tiene client_id)
    await adminDs.query(
      `INSERT INTO eventos_crudos (id, client_id, payload) VALUES ($1,$3,'{}'), ($2,$4,'{}')`,
      [EV_A, EV_B, CLIENT_A, CLIENT_B],
    );
    await adminDs.query(
      `INSERT INTO f1_reprocess_log (evento_crudo_id, notes) VALUES ($1,'log A'), ($2,'log B')`,
      [EV_A, EV_B],
    );

    const qr = adminDs.createQueryRunner();
    await new ExtendRLSCoverage1700000000040().up(qr);
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
      extra: { max: 1 },
    });
    await appDs.initialize();
  });

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
      const qr = adminDs.createQueryRunner();
      await new ExtendRLSCoverage1700000000040().down(qr);
      await qr.release();

      await adminDs.query(`DELETE FROM f1_reprocess_log WHERE evento_crudo_id = ANY($1)`, [[EV_A, EV_B]]);
      await adminDs.query(`DELETE FROM eventos_crudos WHERE id = ANY($1)`, [[EV_A, EV_B]]);
      await adminDs.query(`DELETE FROM mind_chat_history WHERE client_id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await adminDs.query(
        `DELETE FROM equivalencias_ocr_cc WHERE client_id = ANY($1) OR keyword = 'GLOBAL'`,
        [[CLIENT_A, CLIENT_B]],
      );
      await adminDs.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await adminDs.query(`REVOKE ALL ON mind_chat_history, equivalencias_ocr_cc, f1_reprocess_log, eventos_crudos FROM ${ROLE}`);
      await adminDs.query(`REVOKE USAGE ON SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await adminDs.destroy();
    }
  });

  // ── Grupo A estándar ──
  it('mind_chat_history: cada tenant ve solo su chat', async () => {
    const a = await runWithTenant(appDs, CLIENT_A, () =>
      proxy().query(`SELECT mensaje FROM mind_chat_history WHERE mensaje LIKE 'chat%'`),
    );
    expect(sorted(a, 'mensaje')).toEqual(['chat A']);
    const b = await runWithTenant(appDs, CLIENT_B, () =>
      proxy().query(`SELECT mensaje FROM mind_chat_history WHERE mensaje LIKE 'chat%'`),
    );
    expect(sorted(b, 'mensaje')).toEqual(['chat B']);
  });

  it('mind_chat_history: WITH CHECK rechaza INSERT con client_id ajeno', async () => {
    await expect(
      runWithTenant(appDs, CLIENT_A, () =>
        proxy().query(
          `INSERT INTO mind_chat_history (client_id, user_id, role, mensaje) VALUES ($1,$2,'user','x')`,
          [CLIENT_B, randomUUID()],
        ),
      ),
    ).rejects.toThrow();
  });

  // ── equivalencias_ocr_cc: globales visibles, no creables ──
  it('equivalencias: cada tenant ve las GLOBALES (NULL) + las suyas, no las ajenas', async () => {
    const a = await runWithTenant(appDs, CLIENT_A, () =>
      proxy().query(`SELECT keyword FROM equivalencias_ocr_cc`),
    );
    expect(sorted(a, 'keyword')).toEqual(['A-only', 'GLOBAL']);
    const b = await runWithTenant(appDs, CLIENT_B, () =>
      proxy().query(`SELECT keyword FROM equivalencias_ocr_cc`),
    );
    expect(sorted(b, 'keyword')).toEqual(['B-only', 'GLOBAL']);
  });

  it('equivalencias: WITH CHECK rechaza crear una GLOBAL (client_id NULL) desde runtime', async () => {
    await expect(
      runWithTenant(appDs, CLIENT_A, () =>
        proxy().query(
          `INSERT INTO equivalencias_ocr_cc (client_id, keyword, categoria, destino) VALUES (NULL,'EVIL','c','gastos')`,
        ),
      ),
    ).rejects.toThrow();
  });

  // ── f1_reprocess_log: aislado por subquery a eventos_crudos ──
  it('f1_reprocess_log: cada tenant ve solo los logs de SUS eventos (sin client_id propio)', async () => {
    const a = await runWithTenant(appDs, CLIENT_A, () =>
      proxy().query(`SELECT notes FROM f1_reprocess_log`),
    );
    expect(sorted(a, 'notes')).toEqual(['log A']);
    const b = await runWithTenant(appDs, CLIENT_B, () =>
      proxy().query(`SELECT notes FROM f1_reprocess_log`),
    );
    expect(sorted(b, 'notes')).toEqual(['log B']);
  });
});
