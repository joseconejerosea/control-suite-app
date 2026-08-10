/// <reference types="jest" />
import { DataSource, QueryRunner } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

const CLIENT = 'client-uuid-1';
const USER_1 = 'user-uuid-1';
const USER_2 = 'user-uuid-2';
const NOTIF_1 = 'notif-uuid-1';

const PAYLOAD = {
  type: 'evidence_unknown_persona',
  title: 'Promotor desconocido',
  body: 'Revisar evidencia',
};

describe('NotificationsService', () => {
  let svc: NotificationsService;
  let queryMock: jest.Mock;

  const makeQueryRunner = (): QueryRunner =>
    ({
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      query: (sql: string, params?: any[]) => queryMock(sql, params),
      manager: { getRepository: jest.fn() },
    }) as unknown as QueryRunner;

  beforeEach(() => {
    queryMock = jest.fn((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('INSERT INTO notifications')) return Promise.resolve([]);
      if (sql.includes('SELECT') && sql.includes('FROM notifications'))
        return Promise.resolve([]);
      if (sql.includes('UPDATE notifications')) return Promise.resolve([]);
      if (sql.includes('SELECT id FROM users')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const ds = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    svc = new NotificationsService(ds);
  });

  // ── notifyUsers ──────────────────────────────────────────────────────────

  it('notifyUsers with [u1, u2] creates 2 rows in a single atomic INSERT (one row per user)', async () => {
    await svc.notifyUsers(CLIENT, [USER_1, USER_2], PAYLOAD);

    const insertCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO notifications'),
    );
    // Atomic broadcast: a SINGLE multi-row INSERT, not one tx per recipient.
    expect(insertCalls.length).toBe(1);

    const [sql, params] = insertCalls[0];
    // Two VALUES tuples → two rows for two users.
    expect((sql.match(/\(\$1,/g) ?? []).length).toBe(2);
    // Shared payload params ($1..$5) + one user_id per recipient.
    expect(params).toContain(USER_1);
    expect(params).toContain(USER_2);
  });

  it('notifyUsers with a single [u1] inserts exactly 1 row', async () => {
    await svc.notifyUsers(CLIENT, [USER_1], PAYLOAD);

    const insertCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO notifications'),
    );
    expect(insertCalls.length).toBe(1);
    const [sql, params] = insertCalls[0];
    // Exactly one VALUES tuple → one row.
    expect((sql.match(/\(\$1,/g) ?? []).length).toBe(1);
    expect(params).toContain(CLIENT);
    expect(params).toContain(USER_1);
    expect(params).toContain(PAYLOAD.type);
    expect(params).toContain(PAYLOAD.title);
  });

  it('notifyUsers with empty array is a no-op (0 inserts, no exception)', async () => {
    await expect(svc.notifyUsers(CLIENT, [], PAYLOAD)).resolves.not.toThrow();

    const insertCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO notifications'),
    );
    expect(insertCalls.length).toBe(0);
  });

  // ── listForUser / unreadCount ─────────────────────────────────────────────

  it('listForUser without unreadOnly returns rows and unreadCount', async () => {
    const fakeRows = [
      {
        id: NOTIF_1,
        user_id: USER_1,
        read_at: null,
        title: 'Test 1',
        type: 'test',
      },
      {
        id: 'notif-2',
        user_id: USER_1,
        read_at: new Date(),
        title: 'Test 2',
        type: 'test',
      },
    ];
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM notifications') &&
        sql.includes('COUNT')
      ) {
        return Promise.resolve([{ count: '1' }]);
      }
      if (sql.includes('SELECT') && sql.includes('FROM notifications')) {
        return Promise.resolve(fakeRows);
      }
      return Promise.resolve([]);
    });

    const result = await svc.listForUser(CLIENT, USER_1, false);

    expect(result.data).toHaveLength(2);
    expect(result.unreadCount).toBe(1);
  });

  it('listForUser with unreadOnly=true adds read_at IS NULL to the query', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('COUNT')) return Promise.resolve([{ count: '2' }]);
      if (sql.includes('FROM notifications')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await svc.listForUser(CLIENT, USER_1, true);

    const listCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.includes('FROM notifications') &&
        !sql.includes('COUNT'),
    );
    expect(listCall).toBeDefined();
    expect(listCall[0]).toContain('read_at IS NULL');
  });

  // ── markRead ─────────────────────────────────────────────────────────────

  it('markRead with own notification sets read_at and returns the row', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('UPDATE notifications')) {
        // Real TypeORM shape for UPDATE ... RETURNING: [rows, affectedCount].
        return Promise.resolve([[{ id: NOTIF_1, read_at: new Date() }], 1]);
      }
      return Promise.resolve([]);
    });

    await expect(svc.markRead(CLIENT, USER_1, NOTIF_1)).resolves.not.toThrow();

    const updateCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('UPDATE notifications'),
    );
    expect(updateCall).toBeDefined();
    // Must include user_id predicate to enforce own-only
    expect(updateCall[0]).toContain('user_id');
    const params: any[] = updateCall[1];
    expect(params).toContain(NOTIF_1);
    expect(params).toContain(USER_1);
  });

  it('markRead returns 0 rows → throws NotFoundException (foreign notification rejected)', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      // Real TypeORM shape for 0 matched rows: [[], 0] — length 2, NOT a flat [].
      // This is the shape that made the own-only guard silently pass in production.
      if (sql.includes('UPDATE notifications')) return Promise.resolve([[], 0]);
      return Promise.resolve([]);
    });

    await expect(svc.markRead(CLIENT, USER_1, NOTIF_1)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('markRead is idempotent: already-read notification returns without error', async () => {
    // Simula que el UPDATE actualiza 1 fila (read_at ya estaba seteado, pero SET read_at=now() sigue siendo válido)
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('UPDATE notifications')) {
        return Promise.resolve([[{ id: NOTIF_1, read_at: new Date() }], 1]);
      }
      return Promise.resolve([]);
    });

    await expect(svc.markRead(CLIENT, USER_1, NOTIF_1)).resolves.not.toThrow();
  });

  // ── markAllRead ───────────────────────────────────────────────────────────

  it('markAllRead with zero unread rows returns without error (idempotent)', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('UPDATE notifications')) return Promise.resolve([]); // 0 rows
      return Promise.resolve([]);
    });

    await expect(svc.markAllRead(CLIENT, USER_1)).resolves.not.toThrow();
  });

  it('markAllRead sets read_at for own unread rows only (user_id + read_at IS NULL in predicate)', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('UPDATE notifications'))
        return Promise.resolve([{}, {}, {}]); // 3 rows
      return Promise.resolve([]);
    });

    await svc.markAllRead(CLIENT, USER_1);

    const updateCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('UPDATE notifications'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('user_id');
    expect(updateCall[0]).toContain('read_at IS NULL');
    expect(updateCall[1]).toContain(USER_1);
  });

  // ── resolveManagerIds ─────────────────────────────────────────────────────

  it('resolveManagerIds queries users by client_id and role admin_cliente', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM users'))
        return Promise.resolve([{ id: 'mgr-1' }, { id: 'mgr-2' }]);
      return Promise.resolve([]);
    });

    const ids = await svc.resolveManagerIds(CLIENT);

    expect(ids).toEqual(['mgr-1', 'mgr-2']);
    const usersCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('FROM users'),
    );
    expect(usersCall).toBeDefined();
    expect(usersCall[0]).toContain('admin_cliente');
    expect(usersCall[1]).toContain(CLIENT);
  });

  it('resolveManagerIds returns empty array when no managers exist', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM users')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const ids = await svc.resolveManagerIds(CLIENT);
    expect(ids).toEqual([]);
  });

  it('resolveManagerIds propagates a DB error (does NOT swallow into an empty list)', async () => {
    const dbError = new Error('connection reset');
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM users')) return Promise.reject(dbError);
      return Promise.resolve([]);
    });

    await expect(svc.resolveManagerIds(CLIENT)).rejects.toThrow(
      'connection reset',
    );
  });
});
