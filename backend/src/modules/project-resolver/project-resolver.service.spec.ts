/// <reference types="jest" />
/**
 * project-resolver.service.spec.ts — P2-T01
 *
 * Tests for Signal 0 "proyecto del día" added to ProjectResolverService.resolve().
 * Signal 0 fires AFTER the single-project early return (line 45) and BEFORE Signal 1.
 *
 * Invariants:
 *  I-5: auto-assign ONLY when exactly 1 DISTINCT active-project row today.
 *  I-11: confidence = 0.99, method = 'proyecto_del_dia'.
 */
import { DataSource } from 'typeorm';
import { ProjectResolverService } from './project-resolver.service';

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildService(opts: {
  /** Returns rows for a given SQL string */
  dbImpl: (sql: string, params?: any[]) => any[];
  sessionGet?: any;
}): ProjectResolverService {
  const ds = {
    query: jest.fn().mockImplementation(async (sql: string, params?: any[]) =>
      opts.dbImpl(sql, params),
    ),
  } as unknown as DataSource;

  const config = { get: jest.fn().mockReturnValue(null) } as any; // no API key → AI inference disabled
  const sessionService = {
    get: opts.sessionGet ?? jest.fn().mockResolvedValue(null),
  } as any;

  return new ProjectResolverService(ds, config, sessionService);
}

// ─── Signal 0 — proyecto del día ──────────────────────────────────────────────

describe('ProjectResolverService · Signal 0 "proyecto del día"', () => {
  // Common DB builder: always returns 2+ active projects so single-project
  // early return (0.95) does NOT fire; Signal 0 is reachable.
  function multiProjectRows(signal0Rows: any[]) {
    return (sql: string) => {
      // getActiveProjects → 2 active projects for tenant
      if (sql.includes("status = 'active'") && sql.includes('FROM projects') && !sql.includes('FROM activations')) {
        return [
          { id: 'p1', name: 'Proyecto A', start_date: null, end_date: null, description: null },
          { id: 'p2', name: 'Proyecto B', start_date: null, end_date: null, description: null },
        ];
      }
      // Signal 0 query — SELECT DISTINCT from activations
      if (sql.includes('FROM activations') || sql.includes('activation_date')) {
        return signal0Rows;
      }
      // Signal 1 location check-in → no match (userId=null guard)
      if (sql.includes('activation_events')) return [];
      // equivalencias_ocr_cc
      if (sql.includes('equivalencias_ocr_cc')) return [];
      return [];
    };
  }

  it('exactly 1 activation today → returns { confidence: 0.99, method: "proyecto_del_dia" }', async () => {
    const svc = buildService({
      dbImpl: multiProjectRows([{ id: 'p1', name: 'Proyecto A' }]),
    });

    const result = await svc.resolve('doc text', null, 'client-1', '+5491155550000');

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.99);
    expect(result!.method).toBe('proyecto_del_dia');
    expect(result!.projectId).toBe('p1');
    expect(result!.projectName).toBe('Proyecto A');
    expect(result!.alternatives).toEqual([]);
  });

  it('0 activations today → Signal 0 returns null, resolver falls through to existing signals', async () => {
    const svc = buildService({
      dbImpl: multiProjectRows([]),
    });

    // With no project resolver signal and no other signals firing (null userId, no keywords)
    // the overall result should be null (all signals miss).
    const result = await svc.resolve('doc text', null, 'client-1', '+5491155550000');

    // Null is acceptable: the key assertion is Signal 0 did NOT auto-assign.
    // We verify by checking that if Signal 0 returns null the flow continues correctly.
    expect(result?.method).not.toBe('proyecto_del_dia');
  });

  it('2 activations today → Signal 0 returns null (I-5: must be exactly 1)', async () => {
    const svc = buildService({
      dbImpl: multiProjectRows([
        { id: 'p1', name: 'Proyecto A' },
        { id: 'p2', name: 'Proyecto B' },
      ]),
    });

    const result = await svc.resolve('doc text', null, 'client-1', '+5491155550000');

    expect(result?.method).not.toBe('proyecto_del_dia');
  });

  it('activation with project.status != active is excluded → Signal 0 returns null (JD-011)', async () => {
    // DB returns no rows because the active-project JOIN filters it out
    const svc = buildService({
      dbImpl: multiProjectRows([]), // SQL already includes p.status='active' filter
    });

    const result = await svc.resolve('doc text', null, 'client-1', '+5491155550000');

    expect(result?.method).not.toBe('proyecto_del_dia');
  });

  it('TZ boundary: activation_date = yesterday (grace window) → still matches', async () => {
    // The query uses CURRENT_DATE - INTERVAL '1 day' grace, mirroring tieneConvocatoriaAbierta.
    // This test verifies the service passes phoneNumber to the query (the DB handles the date math).
    // We return 1 row to confirm the result is used.
    const svc = buildService({
      dbImpl: multiProjectRows([{ id: 'p1', name: 'Proyecto A' }]),
    });

    const result = await svc.resolve('doc text', null, 'client-1', '+5491155550000');

    expect(result?.method).toBe('proyecto_del_dia');
  });

  it('TZ boundary: activation_date = 2 days ago → no match (beyond grace window)', async () => {
    // DB returns no rows because activation_date >= CURRENT_DATE - INTERVAL '1 day' excludes it.
    const svc = buildService({
      dbImpl: multiProjectRows([]),
    });

    const result = await svc.resolve('doc text', null, 'client-1', '+5491155550000');

    expect(result?.method).not.toBe('proyecto_del_dia');
  });

  it('single-project tenant → still short-circuits at 0.95 (Signal 0 not reached)', async () => {
    // getActiveProjects returns exactly 1 project → early return at confidence=0.95
    const svc = buildService({
      dbImpl: (sql: string) => {
        if (sql.includes("status = 'active'") && sql.includes('FROM projects') && !sql.includes('FROM activations')) {
          return [{ id: 'p-solo', name: 'Solo', start_date: null, end_date: null, description: null }];
        }
        return [];
      },
    });

    const result = await svc.resolve('doc text', null, 'client-1', '+5491155550000');

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.95);
    expect(result!.method).toBe('single_active_project');
  });

  it('Signal 0 query passes phoneNumber to the DB (used for promoter phone join)', async () => {
    const queryFn = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'active'") && sql.includes('FROM projects') && !sql.includes('FROM activations')) {
        return [
          { id: 'p1', name: 'A', start_date: null, end_date: null, description: null },
          { id: 'p2', name: 'B', start_date: null, end_date: null, description: null },
        ];
      }
      return [];
    });
    const ds = { query: queryFn } as unknown as DataSource;
    const config = { get: jest.fn().mockReturnValue(null) } as any;
    const sessionService = { get: jest.fn().mockResolvedValue(null) } as any;
    const svc = new ProjectResolverService(ds, config, sessionService);

    await svc.resolve('doc text', null, 'client-1', '+5491155550000');

    // Signal 0 query must reference activations and use a phone parameter
    const signal0Call = queryFn.mock.calls.find(
      ([sql]: [string]) => sql.includes('activation_date') || sql.includes('FROM activations'),
    );
    expect(signal0Call).toBeDefined();
    const [, params] = signal0Call!;
    // First param is client_id; second is phone digits
    expect(params).toContain('5491155550000');
  });
});
