/// <reference types="jest" />
/**
 * classify.processor.spec.ts — TASK-A07
 *
 * Tests for classify.processor.ts modifications (Slice A):
 *  - Case 3 (0 active projects): MANAGER → beginProjectCreate, non-MANAGER → denial
 *  - Case 2 (>1 active projects): MANAGER → allowCreate=true, non-MANAGER → allowCreate=false
 *  - Case 1 (1 active project): auto-file unchanged (regression)
 *  - ADR-12: resolved_project_id short-circuits resolve() + clarification block
 *
 * Tests call classifyEvento directly (private, cast to any) to avoid runWithTenant overhead.
 */
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { ClassifyProcessor } from './classify.processor';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeQueryRunner(queryFn: jest.Mock = jest.fn().mockResolvedValue([])) {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    isTransactionActive: true,
    query: queryFn,
  };
}

interface BuildOpts {
  dbRows?: (sql: string, params?: any[]) => any[];
  resolveResult?: any;
  aiResult?: any;
  canCreateProjectResult?: boolean;
  beginProjectCreate?: jest.Mock;
  requestProjectClarification?: jest.Mock;
  requestDataClarification?: jest.Mock;
  persistQueueAdd?: jest.Mock;
  sendText?: jest.Mock;
}

function buildProcessor(opts: BuildOpts = {}) {
  const persistQueueAdd = opts.persistQueueAdd ?? jest.fn().mockResolvedValue({});
  const beginProjectCreate = opts.beginProjectCreate ?? jest.fn().mockResolvedValue(undefined);
  const requestProjectClarification = opts.requestProjectClarification ?? jest.fn().mockResolvedValue(undefined);
  const sendText = opts.sendText ?? jest.fn().mockResolvedValue(true);
  const canCreateProjectResult = opts.canCreateProjectResult ?? false;

  const queryFn = jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
    if (opts.dbRows) return opts.dbRows(sql, params) ?? [];
    return [];
  });

  const queryRunner = makeQueryRunner(queryFn);
  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
    query: queryFn,
  } as unknown as DataSource;

  const metrics = {
    f1EventsTotal: { inc: jest.fn() },
    f1AiDuration: { observe: jest.fn() },
    f1ConfidenceScore: { observe: jest.fn() },
  };

  const canCreateProjectMock = jest.fn().mockResolvedValue(canCreateProjectResult);
  const getUserLanguageForCreateMock = jest.fn().mockResolvedValue('es');

  const requestDataClarification = opts.requestDataClarification ?? jest.fn().mockResolvedValue(undefined);

  const clarificationService = {
    requestProjectClarification,
    requestDataClarification,
    beginProjectCreate,
    canCreateProject: canCreateProjectMock,
    getUserLanguageForCreate: getUserLanguageForCreateMock,
  };

  const resolveMock = jest.fn().mockResolvedValue(
    opts.resolveResult !== undefined ? opts.resolveResult : null,
  );

  const projectResolver = { resolve: resolveMock };

  const wa = {
    sendText,
    avisarFalloProcesamiento: jest.fn().mockResolvedValue(true),
  };

  const processor = new ClassifyProcessor(
    dataSource,
    { add: persistQueueAdd } as any,
    { get: jest.fn().mockReturnValue('test-key') } as any,
    metrics as any,
    projectResolver as any,
    clarificationService as any,
    wa as any,
  );

  // Stub the AI call to avoid real HTTP calls
  const aiResult = opts.aiResult ?? {
    tipo: 'factura_recibida',
    destino: 'gastos',
    confidence_score: 0.4, // low_confidence
    datos_extraidos: { monto_total: 100, fecha_emision: '2026-01-01', razon_social_emisor: 'Test Co' },
    proyecto_id_sugerido: null,
    proyecto_alternativos: [],
    alertas: [],
  };
  jest.spyOn(processor as any, 'callClaude').mockResolvedValue(aiResult);

  return {
    processor,
    persistQueueAdd,
    beginProjectCreate,
    requestProjectClarification,
    requestDataClarification,
    sendText,
    canCreateProjectMock,
    resolveMock,
    queryFn,
  };
}

function buildJob(eventoId = 'ec-test', canal = 'whatsapp'): Job<any> {
  return {
    id: 'job-1',
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: { evento_crudo_id: eventoId, client_id: 'client-1', canal },
  } as any;
}

// ─── Case 3 (0 active projects) ───────────────────────────────────────────────

describe('ClassifyProcessor · Case 3 — 0 active projects', () => {
  function buildCase3Rows(fromPhone: string, parsedData: any = null) {
    return (sql: string) => {
      if (sql.includes('FROM eventos_crudos')) {
        return [{ ocr_text: 'factura test', payload: { from: fromPhone }, canal: 'whatsapp', parsed_data: parsedData }];
      }
      if (sql.includes('FROM clients')) return [{ nombre: 'Test', config: {} }];
      if (sql.includes('equivalencias_ocr_cc')) return [];
      if (sql.includes("status = 'active'")) return []; // 0 projects
      return [];
    };
  }

  it('MANAGER sender → calls beginProjectCreate (Case 3)', async () => {
    const beginProjectCreate = jest.fn().mockResolvedValue(undefined);

    const { processor } = buildProcessor({
      dbRows: buildCase3Rows('5491155550000'),
      canCreateProjectResult: true,
      beginProjectCreate,
    });

    const job = buildJob('ec-case3-manager');
    await (processor as any).classifyEvento(job);

    expect(beginProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({ eventoCrudoId: 'ec-case3-manager' }),
    );
  });

  it('MANAGER sender → does NOT enqueue to persist (processing suspended)', async () => {
    const persistQueueAdd = jest.fn().mockResolvedValue({});

    const { processor } = buildProcessor({
      dbRows: buildCase3Rows('5491155550000'),
      canCreateProjectResult: true,
      persistQueueAdd,
    });

    const job = buildJob('ec-case3-no-persist');
    await (processor as any).classifyEvento(job);

    expect(persistQueueAdd).not.toHaveBeenCalled();
  });

  it('non-MANAGER sender → sends denial message, does NOT call beginProjectCreate', async () => {
    const beginProjectCreate = jest.fn().mockResolvedValue(undefined);
    const sendText = jest.fn().mockResolvedValue(true);

    const { processor } = buildProcessor({
      dbRows: buildCase3Rows('5491155551111'),
      canCreateProjectResult: false,
      beginProjectCreate,
      sendText,
    });

    const job = buildJob('ec-case3-nonmanager');
    await (processor as any).classifyEvento(job);

    expect(beginProjectCreate).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalled(); // denial message sent
  });
});

// ─── Case 2 (>1 active projects) ─────────────────────────────────────────────

describe('ClassifyProcessor · Case 2 — >1 active projects', () => {
  function buildCase2Rows(fromPhone: string, parsedData: any = null) {
    return (sql: string) => {
      if (sql.includes('FROM eventos_crudos')) {
        return [{ ocr_text: 'factura test', payload: { from: fromPhone }, canal: 'whatsapp', parsed_data: parsedData }];
      }
      if (sql.includes('FROM clients')) return [{ nombre: 'Test', config: {} }];
      if (sql.includes('equivalencias_ocr_cc')) return [];
      if (sql.includes("status = 'active'")) {
        return [{ id: 'p1', name: 'Proyecto A' }, { id: 'p2', name: 'Proyecto B' }];
      }
      return [];
    };
  }

  it('MANAGER sender → requestProjectClarification called with allowCreate=true', async () => {
    const requestProjectClarification = jest.fn().mockResolvedValue(undefined);

    const { processor } = buildProcessor({
      dbRows: buildCase2Rows('5491155550000'),
      canCreateProjectResult: true,
      requestProjectClarification,
    });

    const job = buildJob('ec-case2-manager');
    await (processor as any).classifyEvento(job);

    expect(requestProjectClarification).toHaveBeenCalledWith(
      expect.objectContaining({ allowCreate: true }),
    );
  });

  it('non-MANAGER sender → requestProjectClarification called with allowCreate=false', async () => {
    const requestProjectClarification = jest.fn().mockResolvedValue(undefined);

    const { processor } = buildProcessor({
      dbRows: buildCase2Rows('5491155551111'),
      canCreateProjectResult: false,
      requestProjectClarification,
    });

    const job = buildJob('ec-case2-nonmanager');
    await (processor as any).classifyEvento(job);

    expect(requestProjectClarification).toHaveBeenCalledWith(
      expect.objectContaining({ allowCreate: false }),
    );
  });
});

// ─── ADR-12 — resolved_project_id short-circuit ──────────────────────────────

describe('ClassifyProcessor · ADR-12 — resolved_project_id short-circuit', () => {
  it('resolved_project_id set → resolve() NOT called, clarification NOT triggered', async () => {
    const resolveMock = jest.fn().mockResolvedValue(null);
    const requestProjectClarification = jest.fn().mockResolvedValue(undefined);
    const beginProjectCreate = jest.fn().mockResolvedValue(undefined);
    const persistQueueAdd = jest.fn().mockResolvedValue({});

    const { processor } = buildProcessor({
      dbRows: (sql: string) => {
        if (sql.includes('FROM eventos_crudos')) {
          return [{
            ocr_text: 'factura test',
            payload: { from: '5491155550000' },
            canal: 'whatsapp',
            parsed_data: { resolved_project_id: 'P-chosen' }, // Already resolved
          }];
        }
        if (sql.includes('FROM clients')) return [{ nombre: 'Test', config: {} }];
        if (sql.includes('equivalencias_ocr_cc')) return [];
        if (sql.includes("status = 'active'")) {
          return [{ id: 'p-other', name: 'Other' }]; // other projects exist
        }
        return [];
      },
      resolveResult: null,
      persistQueueAdd,
      requestProjectClarification,
      beginProjectCreate,
    });

    // Override resolveMock after buildProcessor has set the default
    jest.spyOn(processor['projectResolver'], 'resolve').mockImplementation(resolveMock);

    const job = buildJob('ec-adr12-resolved');
    await (processor as any).classifyEvento(job);

    // resolve() must NOT be called (ADR-12 short-circuit)
    expect(resolveMock).not.toHaveBeenCalled();
    // No clarification triggered
    expect(requestProjectClarification).not.toHaveBeenCalled();
    expect(beginProjectCreate).not.toHaveBeenCalled();
    // persist IS enqueued (skipped clarification → straight to persist)
    expect(persistQueueAdd).toHaveBeenCalled();

    // [JAA-007] The enqueued job must carry the resolved project as the suggested project.
    const persistPayload = persistQueueAdd.mock.calls[0][1];
    expect(persistPayload.classification.proyecto_id_sugerido).toBe('P-chosen');
  });

  it('resolved_project_id set AND missing critical fields → data clarification STILL runs, project resolution skipped', async () => {
    const resolveMock = jest.fn().mockResolvedValue(null);
    const requestProjectClarification = jest.fn().mockResolvedValue(undefined);
    const beginProjectCreate = jest.fn().mockResolvedValue(undefined);
    const requestDataClarification = jest.fn().mockResolvedValue(undefined);
    const persistQueueAdd = jest.fn().mockResolvedValue({});

    const { processor } = buildProcessor({
      dbRows: (sql: string) => {
        if (sql.includes('FROM eventos_crudos')) {
          return [{
            ocr_text: 'factura test',
            payload: { from: '5491155550000' },
            canal: 'whatsapp',
            parsed_data: { resolved_project_id: 'P-chosen' }, // Already resolved
          }];
        }
        if (sql.includes('FROM clients')) return [{ nombre: 'Test', config: {} }];
        if (sql.includes('equivalencias_ocr_cc')) return [];
        if (sql.includes("status = 'active'")) return [{ id: 'p-other', name: 'Other' }];
        return [];
      },
      // low_confidence classification with MISSING critical OCR fields
      aiResult: {
        tipo: 'factura_recibida',
        destino: 'gastos',
        confidence_score: 0.4, // low_confidence
        datos_extraidos: { monto_total: 0, fecha_emision: 'YYYY-MM-DD', razon_social_emisor: '' },
        proyecto_id_sugerido: null,
        proyecto_alternativos: [],
        alertas: [],
      },
      resolveResult: null,
      persistQueueAdd,
      requestProjectClarification,
      requestDataClarification,
      beginProjectCreate,
    });

    jest.spyOn(processor['projectResolver'], 'resolve').mockImplementation(resolveMock);

    const job = buildJob('ec-adr12-data-clar');
    await (processor as any).classifyEvento(job);

    // ADR-12: project resolution + project clarification/create are skipped...
    expect(resolveMock).not.toHaveBeenCalled();
    expect(requestProjectClarification).not.toHaveBeenCalled();
    expect(beginProjectCreate).not.toHaveBeenCalled();
    // ...but the DATA-clarification branch STILL runs for the missing OCR fields.
    expect(requestDataClarification).toHaveBeenCalled();
    // Data clarification returns early → NOT enqueued to persist.
    expect(persistQueueAdd).not.toHaveBeenCalled();
  });

  it('resolved_project_id in STRING-form parsed_data → short-circuit STILL fires (JBF-002)', async () => {
    // persist.processor and approve() defensively handle a JSON-string parsed_data
    // (jsonb may arrive as a string depending on the driver/path). classify is THE gate
    // that closes the reassign loop, so it must parse the string form the same way before
    // reading resolved_project_id — otherwise the short-circuit silently fails to fire.
    const resolveMock = jest.fn().mockResolvedValue(null);
    const requestProjectClarification = jest.fn().mockResolvedValue(undefined);
    const beginProjectCreate = jest.fn().mockResolvedValue(undefined);
    const persistQueueAdd = jest.fn().mockResolvedValue({});

    const { processor } = buildProcessor({
      dbRows: (sql: string) => {
        if (sql.includes('FROM eventos_crudos')) {
          return [{
            ocr_text: 'factura test',
            payload: { from: '5491155550000' },
            canal: 'whatsapp',
            // STRING form (not an object) — mirrors the jsonb-as-string driver path.
            parsed_data: JSON.stringify({ resolved_project_id: 'P-string' }),
          }];
        }
        if (sql.includes('FROM clients')) return [{ nombre: 'Test', config: {} }];
        if (sql.includes('equivalencias_ocr_cc')) return [];
        if (sql.includes("status = 'active'")) return [{ id: 'p-other', name: 'Other' }];
        return [];
      },
      resolveResult: null,
      persistQueueAdd,
      requestProjectClarification,
      beginProjectCreate,
    });

    jest.spyOn(processor['projectResolver'], 'resolve').mockImplementation(resolveMock);

    const job = buildJob('ec-jbf002-string');
    await (processor as any).classifyEvento(job);

    // Short-circuit must fire even though parsed_data arrived as a JSON string.
    expect(resolveMock).not.toHaveBeenCalled();
    expect(requestProjectClarification).not.toHaveBeenCalled();
    expect(beginProjectCreate).not.toHaveBeenCalled();
    expect(persistQueueAdd).toHaveBeenCalled();
    const persistPayload = persistQueueAdd.mock.calls[0][1];
    expect(persistPayload.classification.proyecto_id_sugerido).toBe('P-string');
  });

  it('resolved_project_id null → resolve() is called normally (backward compat)', async () => {
    const resolveMock = jest.fn().mockResolvedValue({
      projectId: 'p-solo',
      method: 'single_active_project',
      confidence: 0.95,
      alternatives: [],
    });
    const persistQueueAdd = jest.fn().mockResolvedValue({});

    const { processor } = buildProcessor({
      dbRows: (sql: string) => {
        if (sql.includes('FROM eventos_crudos')) {
          return [{
            ocr_text: 'factura test',
            payload: { from: '5491155550000' },
            canal: 'whatsapp',
            parsed_data: null, // No resolved_project_id
          }];
        }
        if (sql.includes('FROM clients')) return [{ nombre: 'Test', config: {} }];
        if (sql.includes('equivalencias_ocr_cc')) return [];
        return [];
      },
      aiResult: {
        tipo: 'factura_recibida',
        destino: 'gastos',
        confidence_score: 0.9, // high confidence
        datos_extraidos: { monto_total: 100, fecha_emision: '2026-01-01', razon_social_emisor: 'Co' },
        proyecto_id_sugerido: null,
        proyecto_alternativos: [],
        alertas: [],
      },
      persistQueueAdd,
    });

    jest.spyOn(processor['projectResolver'], 'resolve').mockImplementation(resolveMock);

    const job = buildJob('ec-adr12-null');
    await (processor as any).classifyEvento(job);

    // resolve() must be called (null → today's behavior)
    expect(resolveMock).toHaveBeenCalled();
  });
});
