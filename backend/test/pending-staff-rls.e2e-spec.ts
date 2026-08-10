import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

import {
  runWithTenant,
  installTenantQueryRouting,
} from '../src/common/tenant/tenant-context';
import { PendingStaffService } from '../src/modules/pending-staff/pending-staff.service';
import { DB } from './helpers';

/**
 * Slice B gap-closing — pending_staff against a REAL Postgres (RLS active).
 * Proves: tenant isolation (USING + WITH CHECK), phone-normalized dedup via
 * ON CONFLICT, estado is NOT reset on a repeated upsert, and markAgregado/
 * markDescartado are tenant-scoped (own-tenant only). Mock specs cannot prove
 * any of these — only a live DB with the UNIQUE constraint + RLS does.
 */

const ROLE = 'pstaff_rls_user';
const ROLE_PW = 'pstaff_pw';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();

describe('Slice B — pending_staff RLS + dedup + tenant-scoped transitions (real Postgres)', () => {
  let adminDs: DataSource;
  let appDs: DataSource;
  let restoreRouting: () => void;
  let service: PendingStaffService;

  beforeAll(async () => {
    adminDs = new DataSource({
      type: 'postgres',
      ...DB,
      ssl: false,
      synchronize: false,
    });
    await adminDs.initialize();

    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(
      `CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`,
    );
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON pending_staff TO ${ROLE}`,
    );

    await adminDs.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
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
    restoreRouting = installTenantQueryRouting(appDs);
    service = new PendingStaffService(appDs);
  });

  afterAll(async () => {
    restoreRouting?.();
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
      await adminDs.query(
        `DELETE FROM pending_staff WHERE client_id = ANY($1)`,
        [[CLIENT_A, CLIENT_B]],
      );
      await adminDs.query(`DELETE FROM clients WHERE id = ANY($1)`, [
        [CLIENT_A, CLIENT_B],
      ]);
      await adminDs.query(`REVOKE ALL ON pending_staff FROM ${ROLE}`);
      await adminDs.query(`REVOKE USAGE ON SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await adminDs.destroy();
    }
  });

  beforeEach(async () => {
    await adminDs.query(`DELETE FROM pending_staff WHERE client_id = ANY($1)`, [
      [CLIENT_A, CLIENT_B],
    ]);
  });

  it('sanity: the app role does NOT have BYPASSRLS', async () => {
    const [row] = await adminDs.query(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [ROLE],
    );
    expect(row.rolbypassrls).toBe(false);
  });

  it('upsert dedups by normalized phone (ON CONFLICT) → one row for two raw formats', async () => {
    await service.upsert(CLIENT_A, '+56 9 1111 2222', 'evidence_unknown', {
      a: 1,
    });
    await service.upsert(CLIENT_A, '56911112222', 'evidence_unknown', { a: 2 });

    const [{ count }] = await adminDs.query(
      `SELECT COUNT(*)::int AS count FROM pending_staff WHERE client_id = $1`,
      [CLIENT_A],
    );
    expect(count).toBe(1);
    // contexto updated on conflict.
    const [row] = await adminDs.query(
      `SELECT contexto FROM pending_staff WHERE client_id=$1`,
      [CLIENT_A],
    );
    expect(row.contexto).toEqual({ a: 2 });
  });

  it('ON CONFLICT does NOT reset estado: an agregado row stays agregado on re-upsert', async () => {
    await service.upsert(CLIENT_A, '56911112222', 'evidence_unknown', {});
    const [{ id }] = await adminDs.query(
      `SELECT id FROM pending_staff WHERE client_id=$1`,
      [CLIENT_A],
    );
    await runWithTenant(appDs, CLIENT_A, () =>
      service.markAgregado(CLIENT_A, id),
    );

    // Same phone comes in again (repeat evidence send).
    await service.upsert(CLIENT_A, '+56 9 1111 2222', 'evidence_unknown', {});

    const [row] = await adminDs.query(
      `SELECT estado FROM pending_staff WHERE client_id=$1`,
      [CLIENT_A],
    );
    expect(row.estado).toBe('agregado');
  });

  it('RLS: tenant B cannot see tenant A rows (raw SELECT, no WHERE)', async () => {
    await service.upsert(CLIENT_A, '56911112222', 'evidence_unknown', {});
    const rows = await runWithTenant(appDs, CLIENT_B, () =>
      appDs.query(`SELECT id FROM pending_staff`),
    );
    expect(rows).toHaveLength(0);
  });

  it('RLS WITH CHECK: inserting a tenant A row while GUC=tenant B is rejected', async () => {
    await expect(
      runWithTenant(appDs, CLIENT_B, () =>
        appDs.query(
          `INSERT INTO pending_staff (client_id, phone, motivo) VALUES ($1,'999','x')`,
          [CLIENT_A],
        ),
      ),
    ).rejects.toThrow();
  });

  it('markAgregado is tenant-scoped: tenant B cannot transition tenant A row', async () => {
    await service.upsert(CLIENT_A, '56911112222', 'evidence_unknown', {});
    const [{ id }] = await adminDs.query(
      `SELECT id FROM pending_staff WHERE client_id=$1`,
      [CLIENT_A],
    );

    await expect(
      runWithTenant(appDs, CLIENT_B, () => service.markAgregado(CLIENT_B, id)),
    ).rejects.toBeInstanceOf(NotFoundException);

    const { phone } = await runWithTenant(appDs, CLIENT_A, () =>
      service.markAgregado(CLIENT_A, id),
    );
    expect(phone).toBe('56911112222');
  });

  it('markDescartado transitions and the row PERSISTS (history)', async () => {
    await service.upsert(CLIENT_A, '56911112222', 'evidence_unknown', {});
    const [{ id }] = await adminDs.query(
      `SELECT id FROM pending_staff WHERE client_id=$1`,
      [CLIENT_A],
    );

    await runWithTenant(appDs, CLIENT_A, () =>
      service.markDescartado(CLIENT_A, id),
    );

    const all = await runWithTenant(appDs, CLIENT_A, () =>
      service.list(CLIENT_A),
    );
    expect(all).toHaveLength(1);
    expect((all[0] as any).estado).toBe('descartado');
  });

  it('list filters by estado', async () => {
    await service.upsert(CLIENT_A, '111', 'x', {});
    await service.upsert(CLIENT_A, '222', 'x', {});
    const [{ id: id2 }] = await adminDs.query(
      `SELECT id FROM pending_staff WHERE client_id=$1 AND phone='222'`,
      [CLIENT_A],
    );
    await runWithTenant(appDs, CLIENT_A, () =>
      service.markDescartado(CLIENT_A, id2),
    );

    const pendientes = await runWithTenant(appDs, CLIENT_A, () =>
      service.list(CLIENT_A, 'pendiente'),
    );
    expect(pendientes).toHaveLength(1);
    expect((pendientes[0] as any).phone).toBe('111');
  });
});
