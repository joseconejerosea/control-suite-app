import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

import {
  runWithTenant,
  installTenantQueryRouting,
} from '../src/common/tenant/tenant-context';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { DB } from './helpers';

/**
 * Slice A gap-closing suite — proves against a REAL Postgres (RLS active) the
 * two security claims the mock-only unit specs cannot: (1) tenant isolation via
 * RLS (USING + WITH CHECK), and (2) per-user isolation via the `user_id`
 * predicate in the service SQL. RLS scopes ONLY client_id, so within one tenant
 * the user_id predicate is the sole thing separating two users — the
 * anti-tautology assertions below fail if that predicate is ever dropped.
 *
 * Mirrors the rls-poc harness: adminDs (postgres, BYPASSRLS) seeds/tears down;
 * appDs runs as a dedicated role WITHOUT BYPASSRLS so RLS actually bites.
 */

const ROLE = 'notif_rls_user';
const ROLE_PW = 'notif_pw';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const USER_A1 = randomUUID();
const USER_A2 = randomUUID();
const USER_B1 = randomUUID();

function seedUser(adminDs: DataSource, id: string, clientId: string) {
  return adminDs.query(
    `INSERT INTO users (id, email, password, role, is_active, client_id, language)
     VALUES ($1, $2, 'x', 'admin_cliente', true, $3, 'es')`,
    [id, `${id}@test.local`, clientId],
  );
}

describe('Slice A — notifications RLS + per-user isolation (real Postgres)', () => {
  let adminDs: DataSource;
  let appDs: DataSource;
  let restoreRouting: () => void;
  let service: NotificationsService;

  beforeAll(async () => {
    adminDs = new DataSource({
      type: 'postgres',
      ...DB,
      ssl: false,
      synchronize: false,
    });
    await adminDs.initialize();

    // Dedicated app role: LOGIN, NOBYPASSRLS, not the table owner.
    await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await adminDs.query(
      `CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}' NOBYPASSRLS`,
    );
    await adminDs.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await adminDs.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO ${ROLE}`,
    );
    await adminDs.query(`GRANT SELECT ON users TO ${ROLE}`);
    await adminDs.query(`GRANT SELECT ON clients TO ${ROLE}`);

    // Seed two tenants + three users (two in A, one in B).
    await adminDs.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await seedUser(adminDs, USER_A1, CLIENT_A);
    await seedUser(adminDs, USER_A2, CLIENT_A);
    await seedUser(adminDs, USER_B1, CLIENT_B);

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
    // Route this.ds.query through the GUC-set QueryRunner inside runWithTenant.
    restoreRouting = installTenantQueryRouting(appDs);
    service = new NotificationsService(appDs);
  });

  afterAll(async () => {
    restoreRouting?.();
    if (appDs?.isInitialized) await appDs.destroy();
    if (adminDs?.isInitialized) {
      await adminDs.query(
        `DELETE FROM notifications WHERE client_id = ANY($1)`,
        [[CLIENT_A, CLIENT_B]],
      );
      await adminDs.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [USER_A1, USER_A2, USER_B1],
      ]);
      await adminDs.query(`DELETE FROM clients WHERE id = ANY($1)`, [
        [CLIENT_A, CLIENT_B],
      ]);
      await adminDs.query(`REVOKE ALL ON notifications FROM ${ROLE}`);
      await adminDs.query(`REVOKE ALL ON users FROM ${ROLE}`);
      await adminDs.query(`REVOKE ALL ON clients FROM ${ROLE}`);
      await adminDs.query(`REVOKE USAGE ON SCHEMA public FROM ${ROLE}`);
      await adminDs.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await adminDs.destroy();
    }
  });

  beforeEach(async () => {
    // Clean slate per test (BYPASSRLS admin connection).
    await adminDs.query(`DELETE FROM notifications WHERE client_id = ANY($1)`, [
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

  it('notifyUsers creates one row per recipient (N users → N rows)', async () => {
    await service.notifyUsers(CLIENT_A, [USER_A1, USER_A2], {
      type: 'test',
      title: 'broadcast',
    });
    const [{ count }] = await adminDs.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE client_id = $1`,
      [CLIENT_A],
    );
    expect(count).toBe(2);
  });

  it('RLS: under tenant B context, tenant A rows are invisible (raw SELECT, no WHERE)', async () => {
    await service.notifyUsers(CLIENT_A, [USER_A1], {
      type: 't',
      title: 'A-only',
    });
    // Raw, un-filtered select routed through tenant B's GUC — RLS must hide A.
    const rows = await runWithTenant(appDs, CLIENT_B, () =>
      appDs.query(`SELECT id FROM notifications`),
    );
    expect(rows).toHaveLength(0);
  });

  it('RLS WITH CHECK: inserting a row for tenant A while GUC=tenant B is rejected', async () => {
    await expect(
      runWithTenant(appDs, CLIENT_B, () =>
        appDs.query(
          `INSERT INTO notifications (client_id, user_id, type, title) VALUES ($1, $2, 'x', 'y')`,
          [CLIENT_A, USER_A1],
        ),
      ),
    ).rejects.toThrow();
  });

  it('per-user list: same tenant, user A1 sees only A1 rows — NOT A2 (only user_id predicate separates them)', async () => {
    await service.notifyUsers(CLIENT_A, [USER_A1], {
      type: 't',
      title: 'for-a1',
    });
    await service.notifyUsers(CLIENT_A, [USER_A2], {
      type: 't',
      title: 'for-a2',
    });

    const a1 = await runWithTenant(appDs, CLIENT_A, () =>
      service.listForUser(CLIENT_A, USER_A1, false),
    );
    expect(a1.data).toHaveLength(1);
    expect(a1.data[0].title).toBe('for-a1');
    expect(a1.data.map((r: any) => r.user_id)).not.toContain(USER_A2);
  });

  it('per-user markRead is own-only: A1 cannot mark A2’s notification', async () => {
    await service.notifyUsers(CLIENT_A, [USER_A2], {
      type: 't',
      title: 'a2-owned',
    });
    const [{ id: a2NotifId }] = await adminDs.query(
      `SELECT id FROM notifications WHERE user_id = $1`,
      [USER_A2],
    );

    // A1 tries to mark A2's notification → NotFound, and it stays unread.
    await expect(
      runWithTenant(appDs, CLIENT_A, () =>
        service.markRead(CLIENT_A, USER_A1, a2NotifId),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const stillUnread = await runWithTenant(appDs, CLIENT_A, () =>
      service.listForUser(CLIENT_A, USER_A2, true),
    );
    expect(stillUnread.unreadCount).toBe(1);

    // The rightful owner CAN mark it.
    await runWithTenant(appDs, CLIENT_A, () =>
      service.markRead(CLIENT_A, USER_A2, a2NotifId),
    );
    const afterOwn = await runWithTenant(appDs, CLIENT_A, () =>
      service.listForUser(CLIENT_A, USER_A2, true),
    );
    expect(afterOwn.unreadCount).toBe(0);
  });

  it('markAllRead is scoped to the caller: A1’s read-all leaves A2 unread', async () => {
    await service.notifyUsers(CLIENT_A, [USER_A1], { type: 't', title: 'a1' });
    await service.notifyUsers(CLIENT_A, [USER_A2], { type: 't', title: 'a2' });

    await runWithTenant(appDs, CLIENT_A, () =>
      service.markAllRead(CLIENT_A, USER_A1),
    );

    const a1 = await runWithTenant(appDs, CLIENT_A, () =>
      service.listForUser(CLIENT_A, USER_A1, true),
    );
    const a2 = await runWithTenant(appDs, CLIENT_A, () =>
      service.listForUser(CLIENT_A, USER_A2, true),
    );
    expect(a1.unreadCount).toBe(0);
    expect(a2.unreadCount).toBe(1);
  });
});
