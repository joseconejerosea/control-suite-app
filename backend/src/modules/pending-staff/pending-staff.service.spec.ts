/// <reference types="jest" />
import { DataSource, QueryRunner } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { PendingStaffService } from './pending-staff.service';

const CLIENT = 'client-uuid-1';
// Digits-only value that normalizePhone would produce from a raw number.
const PHONE = '5491112345678';
const ROW_ID = 'row-uuid-1';
const MOTIVO = 'evidence_unknown';
const CONTEXTO = { eventoCrudoId: 'ev-1' };

describe('PendingStaffService', () => {
  let svc: PendingStaffService;
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
      if (sql.includes('INSERT INTO pending_staff'))
        return Promise.resolve([{ id: ROW_ID }]);
      if (sql.includes('SELECT') && sql.includes('FROM pending_staff'))
        return Promise.resolve([]);
      if (sql.includes('UPDATE pending_staff'))
        return Promise.resolve([[{ id: ROW_ID, phone: PHONE }], 1]);
      return Promise.resolve([]);
    });

    const ds = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    svc = new PendingStaffService(ds);
  });

  // ── upsert ────────────────────────────────────────────────────────────────

  it('upsert normalizes the phone before INSERT (digits only)', async () => {
    await svc.upsert(CLIENT, '+54 9 (11) 1234-5678', MOTIVO, CONTEXTO);

    const insertCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO pending_staff'),
    );
    expect(insertCall).toBeDefined();
    const params: any[] = insertCall[1];
    // The phone param must contain only digits (no +, spaces, dashes)
    const phoneParam = params.find(
      (p: any) => typeof p === 'string' && /^\d+$/.test(p),
    );
    expect(phoneParam).toBeDefined();
    expect(phoneParam).not.toContain('+');
    expect(phoneParam).not.toContain(' ');
    expect(phoneParam).not.toContain('-');
  });

  it('upsert uses ON CONFLICT (client_id, phone) DO UPDATE to dedup same key', async () => {
    await svc.upsert(CLIENT, PHONE, MOTIVO, CONTEXTO);

    const insertCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO pending_staff'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toContain('ON CONFLICT');
    expect(insertCall[0]).toContain('client_id');
    expect(insertCall[0]).toContain('phone');
    expect(insertCall[0]).toContain('DO UPDATE SET');
    // motivo and contexto are updated on conflict
    expect(insertCall[0]).toContain('motivo');
    expect(insertCall[0]).toContain('contexto');
  });

  it('upsert ON CONFLICT does NOT reset estado (keeps existing estado for agregado/descartado rows)', async () => {
    await svc.upsert(CLIENT, PHONE, MOTIVO, CONTEXTO);

    const insertCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO pending_staff'),
    );
    expect(insertCall).toBeDefined();
    const onConflictPart = insertCall[0].toLowerCase();
    // The DO UPDATE SET clause must NOT include 'estado' — estado must not be reset
    const doUpdateIdx = onConflictPart.indexOf('do update set');
    const afterDoUpdate = onConflictPart.slice(doUpdateIdx);
    expect(afterDoUpdate).not.toContain('estado');
  });

  it('upsert passes clientId and contexto (JSONB serialized) in query params', async () => {
    await svc.upsert(CLIENT, PHONE, MOTIVO, CONTEXTO);

    const insertCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO pending_staff'),
    );
    const params: any[] = insertCall[1];
    expect(params).toContain(CLIENT);
    expect(params).toContain(MOTIVO);
    // contexto is JSON-serialized
    const contextoParam = params.find(
      (p: any) => typeof p === 'string' && p.includes('eventoCrudoId'),
    );
    expect(contextoParam).toBeDefined();
  });

  it('upsert runs inside runWithTenant (set_config called with clientId)', async () => {
    await svc.upsert(CLIENT, PHONE, MOTIVO, CONTEXTO);

    const setConfigCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('set_config'),
    );
    expect(setConfigCall).toBeDefined();
    const setConfigSql: string = setConfigCall[0];
    const setConfigParams: any[] = setConfigCall[1] ?? [];
    // Either the client_id is embedded in the SQL or passed as a param
    const hasClientId =
      setConfigSql.includes(CLIENT) ||
      (Array.isArray(setConfigParams) && setConfigParams.includes(CLIENT));
    expect(hasClientId).toBe(true);
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it('list without estado filter returns all tenant rows ordered by created_at DESC', async () => {
    const fakeRows = [
      { id: ROW_ID, phone: PHONE, motivo: MOTIVO, estado: 'pendiente' },
      {
        id: 'row-2',
        phone: '5491112345679',
        motivo: MOTIVO,
        estado: 'agregado',
      },
    ];
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM pending_staff'))
        return Promise.resolve(fakeRows);
      return Promise.resolve([]);
    });

    const result = await svc.list(CLIENT);

    expect(result).toHaveLength(2);
    const listCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('FROM pending_staff'),
    );
    expect(listCall).toBeDefined();
    expect(listCall[0]).toContain('created_at');
    expect(listCall[0].toUpperCase()).toContain('DESC');
    // No estado filter in the query when not provided
    const sql: string = listCall[0];
    expect(sql).not.toMatch(/AND\s+estado\s*=/i);
  });

  it('list with estado filter adds WHERE estado condition', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM pending_staff')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await svc.list(CLIENT, 'pendiente');

    const listCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('FROM pending_staff'),
    );
    expect(listCall).toBeDefined();
    expect(listCall[0]).toContain('estado');
    const params: any[] = listCall[1] ?? [];
    expect(params).toContain('pendiente');
  });

  // ── markAgregado ──────────────────────────────────────────────────────────

  it('markAgregado sets estado=agregado and returns phone of the updated row', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE pending_staff')) {
        // Real TypeORM RETURNING shape: [rows, affectedCount]
        return Promise.resolve([[{ id: ROW_ID, phone: PHONE }], 1]);
      }
      return Promise.resolve([]);
    });

    const result = await svc.markAgregado(CLIENT, ROW_ID);

    expect(result.phone).toBe(PHONE);

    const updateCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('UPDATE pending_staff'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('agregado');
    expect(updateCall[0]).toContain('RETURNING');
    const params: any[] = updateCall[1];
    expect(params).toContain(ROW_ID);
    expect(params).toContain(CLIENT);
  });

  it('markAgregado with 0 rows returned → throws NotFoundException (lesson-1 shape: [[], 0])', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE pending_staff')) {
        // The REALISTIC TypeORM shape for 0 matched rows — NOT a flat [].
        // Its .length is 2 which would silently pass an `if (!result.length)` check.
        return Promise.resolve([[], 0]);
      }
      return Promise.resolve([]);
    });

    await expect(svc.markAgregado(CLIENT, ROW_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── markDescartado ────────────────────────────────────────────────────────

  it('markDescartado sets estado=descartado and returns success (row persists)', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE pending_staff')) {
        return Promise.resolve([[{ id: ROW_ID, phone: PHONE }], 1]);
      }
      return Promise.resolve([]);
    });

    const result = await svc.markDescartado(CLIENT, ROW_ID);

    expect(result).toEqual({ success: true });

    const updateCall = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('UPDATE pending_staff'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('descartado');
    const params: any[] = updateCall[1];
    expect(params).toContain(ROW_ID);
    expect(params).toContain(CLIENT);
  });

  it('markDescartado with 0 rows → throws NotFoundException (lesson-1 shape: [[], 0])', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE pending_staff')) {
        return Promise.resolve([[], 0]);
      }
      return Promise.resolve([]);
    });

    await expect(svc.markDescartado(CLIENT, ROW_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('row persists after markAgregado (UPDATE does not DELETE the row)', async () => {
    // Verifies markAgregado uses UPDATE not DELETE: no DELETE sql should appear.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE pending_staff')) {
        return Promise.resolve([[{ id: ROW_ID, phone: PHONE }], 1]);
      }
      return Promise.resolve([]);
    });

    await svc.markAgregado(CLIENT, ROW_ID);

    const deleteCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.toUpperCase().includes('DELETE FROM pending_staff'),
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('row persists after markDescartado (UPDATE does not DELETE the row)', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE pending_staff')) {
        return Promise.resolve([[{ id: ROW_ID, phone: PHONE }], 1]);
      }
      return Promise.resolve([]);
    });

    await svc.markDescartado(CLIENT, ROW_ID);

    const deleteCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.toUpperCase().includes('DELETE FROM pending_staff'),
    );
    expect(deleteCalls).toHaveLength(0);
  });
});
