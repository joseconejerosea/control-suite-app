/// <reference types="jest" />
/**
 * project-inbox.service.spec.ts
 *
 * Strict TDD spec for ProjectInboxService additions.
 * Tasks: A11/A12 — createDraftFromWhatsApp
 * Future tasks: B01/B03 (approve reassignment), B02/B04 (reject cleanup).
 *
 * External dependencies (DataSource, Queue, AuditService) are fully mocked.
 */
import { DataSource } from 'typeorm';
import { ProjectInboxService } from './project-inbox.service';

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildDs(overrides: { query?: jest.Mock } = {}): DataSource {
  return {
    query: overrides.query ?? jest.fn().mockResolvedValue([]),
    createQueryRunner: jest.fn(),
  } as unknown as DataSource;
}

function buildService(opts: {
  dsQuery?: jest.Mock;
  extractQueueAdd?: jest.Mock;
  auditLog?: jest.Mock;
}): ProjectInboxService {
  const dsQuery = opts.dsQuery ?? jest.fn().mockResolvedValue([]);
  const ds = buildDs({ query: dsQuery });

  const extractQueue = {
    add: opts.extractQueueAdd ?? jest.fn().mockResolvedValue({}),
  };
  const ocrQueue = { add: jest.fn().mockResolvedValue({}) };
  const audit = {
    log: opts.auditLog ?? jest.fn().mockResolvedValue(undefined),
  };

  return new ProjectInboxService(ds, extractQueue as any, ocrQueue as any, audit as any);
}

// ─── TASK-A11/A12 — createDraftFromWhatsApp ──────────────────────────────────

describe('ProjectInboxService · createDraftFromWhatsApp (A11/A12)', () => {
  it('inserts a row with source=WHATSAPP and status=READY', async () => {
    const insertMock = jest.fn().mockResolvedValue([{ id: 'inbox-1' }]);
    const svc = buildService({ dsQuery: insertMock });

    await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Campaña Verano 2026',
      pendingEventoIds: ['ec-42'],
    });

    const callArgs = insertMock.mock.calls[0];
    const sql: string = callArgs[0];

    expect(sql).toMatch(/INSERT INTO project_inbox/i);
    // source and status are embedded in the SQL template (literal values)
    expect(sql).toContain("'WHATSAPP'");
    expect(sql).toContain("'READY'");
  });

  it('sets extracted_data.nombre_proyecto and extracted_data.name from the provided name', async () => {
    const insertMock = jest.fn().mockResolvedValue([{ id: 'inbox-2' }]);
    const svc = buildService({ dsQuery: insertMock });

    await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Proyecto Especial',
      pendingEventoIds: ['ec-10'],
    });

    const callArgs = insertMock.mock.calls[0];
    const params: any[] = callArgs[1];
    // params: [tenantId, rawContentJson, extractedDataJson, missingFieldsJson]
    const extractedStr = params[2]; // index 2 = extracted_data JSON
    expect(extractedStr).toBeDefined();
    const extracted = JSON.parse(extractedStr);
    expect(extracted.nombre_proyecto).toBe('Proyecto Especial');
    expect(extracted.name).toBe('Proyecto Especial');
  });

  it('sets fecha_inicio, fecha_fin, presupuesto_otorgado to null in extracted_data', async () => {
    const insertMock = jest.fn().mockResolvedValue([{ id: 'inbox-3' }]);
    const svc = buildService({ dsQuery: insertMock });

    await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Proyecto X',
      pendingEventoIds: ['ec-11'],
    });

    const callArgs = insertMock.mock.calls[0];
    const params: any[] = callArgs[1];
    // params: [tenantId, rawContentJson, extractedDataJson, missingFieldsJson]
    const extractedStr = params[2]; // index 2 = extracted_data JSON
    const extracted = JSON.parse(extractedStr);
    expect(extracted.fecha_inicio).toBeNull();
    expect(extracted.fecha_fin).toBeNull();
    expect(extracted.presupuesto_otorgado).toBeNull();
  });

  it('sets raw_content.pending_evento_ids and raw_content.created_via=whatsapp', async () => {
    const insertMock = jest.fn().mockResolvedValue([{ id: 'inbox-4' }]);
    const svc = buildService({ dsQuery: insertMock });

    await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Proyecto Y',
      pendingEventoIds: ['ec-55'],
    });

    const callArgs = insertMock.mock.calls[0];
    const params: any[] = callArgs[1];
    // params: [tenantId, rawContentJson, extractedDataJson, missingFieldsJson]
    const rawStr = params[1]; // index 1 = raw_content JSON
    expect(rawStr).toBeDefined();
    const raw = JSON.parse(rawStr);
    expect(raw.pending_evento_ids).toEqual(['ec-55']);
    expect(raw.created_via).toBe('whatsapp');
  });

  it('sets missing_fields = [fecha_inicio, fecha_fin, presupuesto_otorgado]', async () => {
    const insertMock = jest.fn().mockResolvedValue([{ id: 'inbox-5' }]);
    const svc = buildService({ dsQuery: insertMock });

    await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Proyecto Z',
      pendingEventoIds: ['ec-60'],
    });

    const callArgs = insertMock.mock.calls[0];
    const params: any[] = callArgs[1];
    // params: [tenantId, rawContentJson, extractedDataJson, missingFieldsJson]
    const missingStr = params[3]; // index 3 = missing_fields JSON
    expect(missingStr).toBeDefined();
    const missing = JSON.parse(missingStr);
    expect(missing).toEqual(expect.arrayContaining(['fecha_inicio', 'fecha_fin', 'presupuesto_otorgado']));
  });

  it('does NOT enqueue the project-inbox-extract job (no extract for WHATSAPP drafts)', async () => {
    const extractQueueAdd = jest.fn();
    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([{ id: 'inbox-6' }]),
      extractQueueAdd,
    });

    await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Proyecto No Extract',
      pendingEventoIds: ['ec-70'],
    });

    expect(extractQueueAdd).not.toHaveBeenCalled();
  });

  it('sets raw_content.reassign_factura_id when reassignFacturaId is supplied', async () => {
    const insertMock = jest.fn().mockResolvedValue([{ id: 'inbox-7' }]);
    const svc = buildService({ dsQuery: insertMock });

    await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Proyecto Reasignado',
      pendingEventoIds: ['ec-80'],
      reassignFacturaId: 'fac-99',
    });

    const callArgs = insertMock.mock.calls[0];
    const params: any[] = callArgs[1];
    const rawStr = params[1]; // index 1 = raw_content JSON
    expect(rawStr).toBeDefined();
    const raw = JSON.parse(rawStr);
    expect(raw.reassign_factura_id).toBe('fac-99');
  });

  it('does NOT set reassign_factura_id when not supplied', async () => {
    const insertMock = jest.fn().mockResolvedValue([{ id: 'inbox-8' }]);
    const svc = buildService({ dsQuery: insertMock });

    await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Proyecto Normal',
      pendingEventoIds: ['ec-90'],
    });

    const callArgs = insertMock.mock.calls[0];
    const params: any[] = callArgs[1];
    const rawStr = params[1]; // index 1 = raw_content JSON
    const raw = JSON.parse(rawStr);
    expect(raw.reassign_factura_id).toBeUndefined();
  });

  it('returns the created inbox record', async () => {
    const expectedRecord = { id: 'inbox-final', status: 'READY', source: 'WHATSAPP' };
    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([expectedRecord]),
    });

    const result = await svc.createDraftFromWhatsApp('tenant-1', {
      name: 'Test',
      pendingEventoIds: ['ec-99'],
    });

    expect(result).toEqual(expectedRecord);
  });
});

// ─── TASK-B01/B03 — approve() reassignment (ADR-7) ──────────────────────────

/**
 * BuildServiceWithOcr: builds a ProjectInboxService with an injected ocr queue mock.
 * The service constructor now has 4 args: ds, extractQueue, ocrQueue, audit.
 */
function buildServiceWithOcr(opts: {
  dsQueryImpl?: (sql: string, params?: any[]) => Promise<any>;
  ocrQueueAdd?: jest.Mock;
  auditLog?: jest.Mock;
  qrQueryImpl?: (sql: string, params?: any[]) => Promise<any>;
}): { svc: ProjectInboxService; ocrQueueAdd: jest.Mock; qrQuery: jest.Mock } {
  const ocrQueueAdd = opts.ocrQueueAdd ?? jest.fn().mockResolvedValue({});
  const auditLog = opts.auditLog ?? jest.fn().mockResolvedValue(undefined);

  // Separate query mock for the QueryRunner (used inside approve tx)
  const qrQuery = jest.fn().mockImplementation(opts.qrQueryImpl ?? (async (sql: string) => {
    if (sql.includes('set_config')) return [];
    if (sql.includes('INSERT INTO projects')) return [{ id: 'proj-new' }];
    if (sql.includes('SELECT pi.*')) return [{
      id: 'inbox-1',
      status: 'READY',
      extracted_data: JSON.stringify({ nombre_proyecto: 'Test' }),
      raw_content: JSON.stringify({ pending_evento_ids: ['ec-42'] }),
    }];
    return [];
  }));

  const makeQr = () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    isTransactionActive: true,
    query: (sql: string, params?: any[]) => qrQuery(sql, params),
  });

  // ds.query is used by findOne (SELECT pi.*) — separate from QR
  const dsQuery = jest.fn().mockImplementation(opts.dsQueryImpl ?? (async (sql: string) => {
    if (sql.includes('SELECT pi.*')) {
      return [{
        id: 'inbox-1',
        status: 'READY',
        extracted_data: JSON.stringify({ nombre_proyecto: 'Test' }),
        raw_content: JSON.stringify({ pending_evento_ids: ['ec-42'] }),
      }];
    }
    return [];
  }));

  const ds = {
    query: (sql: string, params?: any[]) => dsQuery(sql, params),
    createQueryRunner: jest.fn(() => makeQr()),
  } as unknown as DataSource;

  const svc = new ProjectInboxService(
    ds,
    { add: jest.fn().mockResolvedValue({}) } as any,  // extractQueue
    { add: ocrQueueAdd } as any,                        // ocrQueue (B05)
    { log: auditLog } as any,                          // audit
  );

  return { svc, ocrQueueAdd, qrQuery };
}

describe('ProjectInboxService · approve() reassignment (B01/B03)', () => {
  it('sets resolved_project_id and status=queued for each pending evento inside the QR tx', async () => {
    const { svc, qrQuery } = buildServiceWithOcr({});

    await svc.approve('tenant-1', 'inbox-1', 'user-1', {}, '127.0.0.1');

    // Find all UPDATE calls on eventos_crudos — resolved_project_id is in JSON params
    const updateEventoCalls = qrQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('eventos_crudos') && sql.includes("'queued'"),
    );
    expect(updateEventoCalls.length).toBe(1);
    const [, params] = updateEventoCalls[0];
    // params[0] = JSON containing resolved_project_id; params[1] = evento id
    expect(params[0]).toContain('proj-new');
    expect(params[1]).toBe('ec-42');
    // Confirm the JSON contains the key
    const parsedData = JSON.parse(params[0]);
    expect(parsedData.resolved_project_id).toBe('proj-new');
  });

  it('enqueues OCR for each pending evento AFTER commitTransaction, not before', async () => {
    // Order is asserted via a shared callLog: commitTransaction pushes 'commit',
    // ocrQueue.add pushes 'ocr'; the fix requires 'commit' before 'ocr'.
    const callLog: string[] = [];

    const qrQueryInstrumented = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('INSERT INTO projects')) return [{ id: 'proj-new' }];
      return [];
    });

    const commitFn = jest.fn().mockImplementation(async () => {
      callLog.push('commit');
    });

    const makeQrInstrumented = () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: commitFn,
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      query: (sql: string, params?: any[]) => qrQueryInstrumented(sql, params),
    });

    const dsQuery2 = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-1',
          status: 'READY',
          extracted_data: JSON.stringify({ nombre_proyecto: 'Test' }),
          raw_content: JSON.stringify({ pending_evento_ids: ['ec-42'] }),
        }];
      }
      return [];
    });

    const ocrQueueAdd2 = jest.fn().mockImplementation(async () => {
      callLog.push('ocr');
      return {};
    });

    const ds2 = {
      query: (sql: string, params?: any[]) => dsQuery2(sql, params),
      createQueryRunner: jest.fn(() => makeQrInstrumented()),
    } as unknown as DataSource;

    const svc2 = new ProjectInboxService(
      ds2,
      { add: jest.fn().mockResolvedValue({}) } as any,
      { add: ocrQueueAdd2 } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await svc2.approve('tenant-1', 'inbox-1', 'user-1', {}, '127.0.0.1');

    // commit must appear before ocr in callLog
    expect(callLog).toContain('commit');
    expect(callLog).toContain('ocr');
    const commitIdx = callLog.indexOf('commit');
    const ocrIdx = callLog.indexOf('ocr');
    expect(commitIdx).toBeLessThan(ocrIdx);
  });

  it('does NOT enqueue OCR when pending_evento_ids is empty', async () => {
    const ocrQueueAdd = jest.fn().mockResolvedValue({});

    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-no-events',
          status: 'READY',
          extracted_data: JSON.stringify({ nombre_proyecto: 'Test' }),
          raw_content: JSON.stringify({ pending_evento_ids: [] }),
        }];
      }
      return [];
    });

    const qrQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('INSERT INTO projects')) return [{ id: 'proj-new' }];
      return [];
    });

    const ds = {
      query: (sql: string, params?: any[]) => dsQuery(sql, params),
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => qrQuery(sql, params),
      })),
    } as unknown as DataSource;

    const svc = new ProjectInboxService(
      ds,
      { add: jest.fn().mockResolvedValue({}) } as any,
      { add: ocrQueueAdd } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await svc.approve('tenant-1', 'inbox-no-events', 'user-1', {}, '127.0.0.1');

    expect(ocrQueueAdd).not.toHaveBeenCalled();
  });

  it('escalates the parked evento (via ds.query) when post-commit ocrQueue.add throws, but still returns the created project_id (JAB-001/JBB-001)', async () => {
    // Commit succeeds; the OCR enqueue for the parked evento fails (queue/Redis outage).
    // The evento was set status='queued' + resolved_project_id inside the committed tx,
    // so without recovery it is orphaned (no job, no surfacing). Fix: escalate it.
    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-1',
          status: 'READY',
          extracted_data: JSON.stringify({ nombre_proyecto: 'Test' }),
          raw_content: JSON.stringify({ pending_evento_ids: ['ec-42'] }),
        }];
      }
      return [];
    });

    const qrQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('INSERT INTO projects')) return [{ id: 'proj-new' }];
      return [];
    });

    const ds = {
      query: (sql: string, params?: any[]) => dsQuery(sql, params),
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => qrQuery(sql, params),
      })),
    } as unknown as DataSource;

    // ocrQueue.add rejects (queue/Redis outage) for the parked evento.
    const ocrQueueAdd = jest.fn().mockRejectedValue(new Error('REDIS_DOWN'));

    const svc = new ProjectInboxService(
      ds,
      { add: jest.fn().mockResolvedValue({}) } as any,
      { add: ocrQueueAdd } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const result = await svc.approve('tenant-1', 'inbox-1', 'user-1', {}, '127.0.0.1');

    // Approval itself succeeded → still returns the created project_id.
    expect(result).toEqual({ project_id: 'proj-new' });

    // The orphaned evento must be escalated via the tenant-routed ds.query
    // (same RLS-safe path reject() uses), NOT left silently 'queued'.
    const escalateCalls = dsQuery.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('eventos_crudos') && sql.includes('escalated'),
    );
    expect(escalateCalls.length).toBe(1);
    expect(escalateCalls[0][1]).toContain('ec-42');
  });

  it('re-enqueues OCR with canal=whatsapp for a parked UNPROCESSED evento (JAF-001)', async () => {
    // The evento is genuinely parked (never persisted): no factura_id, status not 'processed'.
    const ocrQueueAdd = jest.fn().mockResolvedValue({});

    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-1',
          status: 'READY',
          extracted_data: JSON.stringify({ nombre_proyecto: 'Test' }),
          raw_content: JSON.stringify({ pending_evento_ids: ['ec-parked'] }),
        }];
      }
      return [];
    });

    const qrQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('INSERT INTO projects')) return [{ id: 'proj-new' }];
      // Per-evento status probe: parked → NOT persisted.
      if (sql.includes('SELECT') && sql.includes('eventos_crudos')) {
        return [{ factura_id: null, status: 'awaiting_project' }];
      }
      return [];
    });

    const ds = {
      query: (sql: string, params?: any[]) => dsQuery(sql, params),
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => qrQuery(sql, params),
      })),
    } as unknown as DataSource;

    const svc = new ProjectInboxService(
      ds,
      { add: jest.fn().mockResolvedValue({}) } as any,
      { add: ocrQueueAdd } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const result = await svc.approve('tenant-1', 'inbox-1', 'user-1', {}, '127.0.0.1');
    expect(result).toEqual({ project_id: 'proj-new' });

    // Parked evento → OCR IS re-enqueued.
    expect(ocrQueueAdd).toHaveBeenCalledTimes(1);
    const [, payload] = ocrQueueAdd.mock.calls[0];
    expect(payload.evento_crudo_id).toBe('ec-parked');
    expect(payload.client_id).toBe('tenant-1');
    // JAF-001 — canal must be carried so classify's whatsapp gate runs on re-file.
    expect(payload.canal).toBe('whatsapp');

    // Its status is re-pointed to 'queued' inside the tx.
    const requeueCalls = qrQuery.mock.calls.filter(
      ([s]: [string]) => typeof s === 'string' && s.includes('eventos_crudos') && s.includes("'queued'"),
    );
    expect(requeueCalls.length).toBe(1);
  });

  it('does NOT re-enqueue OCR for an ALREADY-PERSISTED evento (factura_id set) but still creates project+draft (JBF-001)', async () => {
    // Sub-case 2 (single_active_project offer): the evento was fully processed into an
    // invoices row BEFORE the NUEVO offer (persist stamps factura_id + status='processed').
    // Re-enqueuing OCR would duplicate/lose the invoice → must be skipped.
    const ocrQueueAdd = jest.fn().mockResolvedValue({});

    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-persisted',
          status: 'READY',
          extracted_data: JSON.stringify({ nombre_proyecto: 'Nuevo Proyecto' }),
          raw_content: JSON.stringify({ pending_evento_ids: ['ec-persisted'] }),
        }];
      }
      return [];
    });

    let projectInserted = false;
    let inboxApproved = false;
    const qrQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('INSERT INTO projects')) { projectInserted = true; return [{ id: 'proj-new' }]; }
      if (sql.includes('UPDATE project_inbox')) { inboxApproved = true; return []; }
      // Per-evento status probe: already persisted (factura_id set, status='processed').
      if (sql.includes('SELECT') && sql.includes('eventos_crudos')) {
        return [{ factura_id: 'fac-123', status: 'processed' }];
      }
      return [];
    });

    const ds = {
      query: (sql: string, params?: any[]) => dsQuery(sql, params),
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => qrQuery(sql, params),
      })),
    } as unknown as DataSource;

    const svc = new ProjectInboxService(
      ds,
      { add: jest.fn().mockResolvedValue({}) } as any,
      { add: ocrQueueAdd } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const result = await svc.approve('tenant-1', 'inbox-persisted', 'user-1', {}, '127.0.0.1');

    // Project + draft approval still happen — the offer is still valuable.
    expect(projectInserted).toBe(true);
    expect(inboxApproved).toBe(true);
    expect(result).toEqual({ project_id: 'proj-new' });

    // JBF-001 — the already-persisted evento must NOT be re-enqueued (no duplicate/loss).
    expect(ocrQueueAdd).not.toHaveBeenCalled();

    // And it must NOT be re-pointed to 'queued' (re-processing signal).
    const requeueCalls = qrQuery.mock.calls.filter(
      ([s]: [string]) => typeof s === 'string' && s.includes('eventos_crudos') && s.includes("'queued'"),
    );
    expect(requeueCalls.length).toBe(0);
  });

  it('rolls back and propagates error when reassignment DML fails (NFR-02 / SCENARIO-21)', async () => {
    const rollbackFn = jest.fn().mockResolvedValue(undefined);

    const qrQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('INSERT INTO projects')) return [{ id: 'proj-new' }];
      // The reassignment UPDATE touches eventos_crudos with status='queued'
      if (sql.includes('eventos_crudos') && sql.includes("'queued'")) {
        throw new Error('DB_REASSIGN_FAIL');
      }
      return [];
    });

    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-1',
          status: 'READY',
          extracted_data: JSON.stringify({ nombre_proyecto: 'Test' }),
          raw_content: JSON.stringify({ pending_evento_ids: ['ec-42'] }),
        }];
      }
      return [];
    });

    const ds = {
      query: (sql: string, params?: any[]) => dsQuery(sql, params),
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: rollbackFn,
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => qrQuery(sql, params),
      })),
    } as unknown as DataSource;

    const ocrQueueAdd = jest.fn().mockResolvedValue({});
    const svc = new ProjectInboxService(
      ds,
      { add: jest.fn().mockResolvedValue({}) } as any,
      { add: ocrQueueAdd } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await expect(
      svc.approve('tenant-1', 'inbox-1', 'user-1', {}, '127.0.0.1'),
    ).rejects.toThrow('DB_REASSIGN_FAIL');

    expect(rollbackFn).toHaveBeenCalled();
    // OCR must NOT be enqueued if tx rolled back
    expect(ocrQueueAdd).not.toHaveBeenCalled();
  });
});

// ─── TASK-B02/B04 — reject() cleanup (ADR-8) ────────────────────────────────

describe('ProjectInboxService · reject() cleanup (B02/B04)', () => {
  it('sets status=escalated for each pending evento via ds.query', async () => {
    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-2',
          status: 'READY',
          extracted_data: null,
          raw_content: JSON.stringify({ pending_evento_ids: ['ec-44'] }),
        }];
      }
      return [];
    });

    const createQueryRunner = jest.fn();
    const ds = {
      query: (sql: string, params?: any[]) => dsQuery(sql, params),
      createQueryRunner,
    } as unknown as DataSource;

    const svc = new ProjectInboxService(
      ds,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await svc.reject('tenant-1', 'inbox-2', 'user-1', 'No budget', '127.0.0.1');

    const escalateCalls = dsQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('eventos_crudos') && sql.includes('escalated'),
    );
    expect(escalateCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = escalateCalls[0];
    expect(params).toContain('ec-44');

    // JBB-005 — The escalation MUST run through the tenant-routed this.ds.query
    // (request-scoped; TenantInterceptor sets app.current_tenant on this connection
    // so RLS applies), NOT through a raw manual QueryRunner that would bypass routing.
    // In this harness, this.ds.query is the only tenant-routed path; asserting the
    // escalation appears in its call log AND that no manual QueryRunner was opened
    // proves the escalation is not issued on an unrouted connection.
    expect(createQueryRunner).not.toHaveBeenCalled();
  });

  it('does not escalate eventos when pending_evento_ids is empty or missing', async () => {
    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-empty',
          status: 'READY',
          extracted_data: null,
          raw_content: JSON.stringify({}),
        }];
      }
      return [];
    });

    const ds = {
      query: (sql: string, params?: any[]) => dsQuery(sql, params),
      createQueryRunner: jest.fn(),
    } as unknown as DataSource;

    const svc = new ProjectInboxService(
      ds,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await svc.reject('tenant-1', 'inbox-empty', 'user-1', 'reason', '127.0.0.1');

    const escalateCalls = dsQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('eventos_crudos') && sql.includes('escalated'),
    );
    expect(escalateCalls.length).toBe(0);
  });

  it('preserves the Already rejected guard (double-reject → BadRequestException)', async () => {
    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT pi.*')) {
        return [{
          id: 'inbox-rej',
          status: 'REJECTED',
          extracted_data: null,
          raw_content: JSON.stringify({ pending_evento_ids: ['ec-50'] }),
        }];
      }
      return [];
    });

    const ds = {
      query: (sql: string, params?: any[]) => dsQuery(sql, params),
      createQueryRunner: jest.fn(),
    } as unknown as DataSource;

    const svc = new ProjectInboxService(
      ds,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const { BadRequestException } = await import('@nestjs/common');
    await expect(
      svc.reject('tenant-1', 'inbox-rej', 'user-1', 'double', '127.0.0.1'),
    ).rejects.toThrow(BadRequestException);
  });
});
