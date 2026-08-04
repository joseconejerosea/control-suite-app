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
  const audit = {
    log: opts.auditLog ?? jest.fn().mockResolvedValue(undefined),
  };

  return new ProjectInboxService(ds, extractQueue as any, audit as any);
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
