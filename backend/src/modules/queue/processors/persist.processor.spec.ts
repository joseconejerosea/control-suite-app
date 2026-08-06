/// <reference types="jest" />
/**
 * Unit test for PersistProcessor error-message sanitization (normalize-user-error-messages
 * audit FIX 3).
 *
 * When persistEvento fails, the raw cause must be logged but the persisted
 * `eventos_crudos.error_message` — which is returned by the API and rendered in the admin
 * UI — must carry only a safe, neutral-Spanish category string, never the raw cause.
 */
import { DataSource, QueryRunner } from 'typeorm';
import { Job } from 'bullmq';
import { PersistProcessor } from './persist.processor';
import { SAFE_MESSAGES } from '../../../common/exceptions';

const RAW_CAUSE = 'duplicate key value violates unique constraint "invoices_pkey" xyz';

describe('PersistProcessor — error_message sanitization', () => {
  let processor: PersistProcessor;
  let queryMock: jest.Mock;
  let dataSource: DataSource;

  beforeEach(() => {
    // Every query rejects with the raw technical cause so persistEvento throws inside
    // the happy-path tenant transaction, driving the catch → sanitized failure write.
    queryMock = jest.fn();

    // Minimal QueryRunner stub for runWithTenant (happy path + separate failure tx).
    const makeQueryRunner = (): QueryRunner =>
      ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        // set_config + any query routed through the runner delegate to queryMock.
        query: (sql: string, params?: any[]) => queryMock(sql, params),
      }) as unknown as QueryRunner;

    dataSource = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    processor = new PersistProcessor(
      dataSource,
      { exportInvoice: jest.fn() } as any,
      { asignarFacturaARendicion: jest.fn() } as any,
      { confirmarProcesado: jest.fn().mockResolvedValue(true) } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() } as any,
    );
  });

  it('persists a safe error_message (never the raw cause) when persistEvento fails', async () => {
    // set_config succeeds; the first business SELECT throws the raw cause.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT payload')) return Promise.reject(new Error(RAW_CAUSE));
      return Promise.resolve([]);
    });

    const job = {
      data: { evento_crudo_id: 'evt-1', client_id: 'client-1', classification: {}, processing_status: 'x' },
    } as unknown as Job<any>;

    await expect(processor.process(job)).rejects.toThrow(RAW_CAUSE);

    const failureWrite = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("status='failed'"),
    );
    expect(failureWrite).toBeDefined();
    const [, params] = failureWrite;
    // The persisted error_message is the safe category string, NOT the raw cause.
    expect(params[0]).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
    expect(params[0]).not.toContain('invoices_pkey');
    expect(params[0]).not.toContain('xyz');
  });
});

describe('PersistProcessor — WhatsApp confirmation (happy path)', () => {
  let processor: PersistProcessor;
  let queryMock: jest.Mock;
  let confirmarProcesado: jest.Mock;
  let dataSource: DataSource;

  beforeEach(() => {
    queryMock = jest.fn((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT payload')) {
        return Promise.resolve([
          {
            // WhatsApp guarda el canal en `source`, no en `canal`.
            canal: null,
            source: 'whatsapp',
            email_from: null,
            payload: { from: '5492216205665' },
          },
        ]);
      }
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ id: 'inv-1' }]);
      if (sql.includes('FROM projects')) return Promise.resolve([{ name: 'Activación Falabella Costanera' }]);
      // resolvePersonaId (promoters/collaborators), UPDATE eventos_crudos, etc.
      return Promise.resolve([]);
    });

    const makeQueryRunner = (): QueryRunner =>
      ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => queryMock(sql, params),
      }) as unknown as QueryRunner;

    dataSource = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    confirmarProcesado = jest.fn().mockResolvedValue(true);

    processor = new PersistProcessor(
      dataSource,
      { exportInvoice: jest.fn().mockResolvedValue(undefined) } as any,
      { asignarFacturaARendicion: jest.fn().mockResolvedValue(undefined) } as any,
      { confirmarProcesado } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() } as any,
    );
  });

  it('sends a rich confirmation reflecting tipo, monto, proyecto and estado', async () => {
    const job = {
      data: {
        evento_crudo_id: 'evt-1',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: 'proj-1',
          datos_extraidos: {
            monto_total: 123456,
            moneda: 'CLP',
            razon_social_emisor: 'Ferretería El Clavo',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    expect(confirmarProcesado).toHaveBeenCalledTimes(1);
    const opts = confirmarProcesado.mock.calls[0][0];
    expect(opts.telefono).toBe('5492216205665');
    expect(opts.tipo).toBe('Factura recibida');
    expect(opts.proveedor).toBe('Ferretería El Clavo');
    expect(opts.monto).toContain('123.456');
    expect(opts.proyecto).toBe('Activación Falabella Costanera');
    expect(opts.estado).toBe('Registrado ✓');
  });

  it('does not send a WhatsApp confirmation for the email channel', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT payload')) {
        return Promise.resolve([
          { canal: 'email', source: 'email', email_from: 'a@b.com', payload: {} },
        ]);
      }
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ id: 'inv-1' }]);
      return Promise.resolve([]);
    });

    const job = {
      data: {
        evento_crudo_id: 'evt-1',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          confidence_score: 0.9,
          datos_extraidos: { monto_total: 100, moneda: 'CLP', razon_social_emisor: 'X' },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    expect(confirmarProcesado).not.toHaveBeenCalled();
  });
});

// ─── TASK-B06/B07 — ADR-12: persist honors resolved_project_id ──────────────

describe('PersistProcessor — ADR-12: resolved_project_id precedence (B06/B07)', () => {
  /**
   * Helper: builds a PersistProcessor with a queryMock that returns standard
   * evento data (whatsapp channel) and an invoice insert returning 'inv-adrl'.
   * The classification has proyecto_id_sugerido optionally, and the evento
   * row optionally has parsed_data.resolved_project_id.
   */
  function buildProcessorWithResolvedId(opts: {
    resolvedProjectId: string | null;
    proyectoIdSugerido?: string | null;
    payloadProjectId?: string | null;
  }) {
    const confirmarProcesado = jest.fn().mockResolvedValue(true);
    const asignarFacturaARendicion = jest.fn().mockResolvedValue(undefined);

    const queryMock = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('SELECT payload')) {
        return [{
          canal: null,
          source: 'whatsapp',
          email_from: null,
          payload: {
            from: '5492216205665',
            ...(opts.payloadProjectId ? { project_id: opts.payloadProjectId } : {}),
          },
          parsed_data: opts.resolvedProjectId !== null
            ? { resolved_project_id: opts.resolvedProjectId }
            : null,
        }];
      }
      if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-adrl' }];
      if (sql.includes('FROM projects WHERE id=')) return [{ name: 'Resolved Project' }];
      // resolvePersonaId: return a promoter so asignarFacturaARendicion is called
      if (sql.includes('FROM promoters')) return [{ id: 'persona-1' }];
      return [];
    });

    const makeQueryRunner = () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    });

    const ds = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    const processor = new PersistProcessor(
      ds,
      { exportInvoice: jest.fn().mockResolvedValue(undefined) } as any,
      { asignarFacturaARendicion } as any,
      { confirmarProcesado } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() } as any,
    );

    return { processor, queryMock, confirmarProcesado, asignarFacturaARendicion };
  }

  it('B06 — rendición derivation uses resolved_project_id over proyecto_id_sugerido', async () => {
    const { processor, asignarFacturaARendicion } = buildProcessorWithResolvedId({
      resolvedProjectId: 'proj-resolved',
      proyectoIdSugerido: 'proj-other',
    });

    const job = {
      data: {
        evento_crudo_id: 'evt-adrl',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: 'proj-other',
          datos_extraidos: {
            monto_total: 5000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor X',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    // asignarFacturaARendicion must receive resolved_project_id, not proyecto_id_sugerido
    expect(asignarFacturaARendicion).toHaveBeenCalled();
    const callArgs = asignarFacturaARendicion.mock.calls[0];
    // signature: (clientId, invoiceId, personaId, projectId, amount, date)
    const projectIdArg = callArgs[3];
    expect(projectIdArg).toBe('proj-resolved');
    expect(projectIdArg).not.toBe('proj-other');
  });

  it('B07 — confirmation derivation uses resolved_project_id over proyecto_id_sugerido', async () => {
    const { processor, queryMock, confirmarProcesado } = buildProcessorWithResolvedId({
      resolvedProjectId: 'proj-resolved',
      proyectoIdSugerido: 'proj-other',
    });

    const job = {
      data: {
        evento_crudo_id: 'evt-adrl',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: 'proj-other',
          datos_extraidos: {
            monto_total: 5000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor X',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    // The SELECT FROM projects to get project name should use proj-resolved, not proj-other
    const projectSelectCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('FROM projects') && sql.includes('WHERE id='),
    );
    expect(projectSelectCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = projectSelectCalls[0];
    expect(params[0]).toBe('proj-resolved');
    expect(params[0]).not.toBe('proj-other');
  });

  it('B06/B07 — null resolved_project_id → legacy behavior: proyecto_id_sugerido used', async () => {
    const { processor, asignarFacturaARendicion, queryMock } = buildProcessorWithResolvedId({
      resolvedProjectId: null,
      proyectoIdSugerido: 'proj-suggested',
    });

    const job = {
      data: {
        evento_crudo_id: 'evt-legacy',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: 'proj-suggested',
          datos_extraidos: {
            monto_total: 1000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor Y',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    // Rendición: projectId should be 'proj-suggested' (legacy behavior)
    expect(asignarFacturaARendicion).toHaveBeenCalled();
    const rendicionArgs = asignarFacturaARendicion.mock.calls[0];
    expect(rendicionArgs[3]).toBe('proj-suggested');

    // Confirmation: the FROM projects lookup MUST have run with the legacy id.
    // JAB-002/JBB-006 — assert unconditionally: a regression that drops the
    // confirmation derivation (never selecting the project) must fail here, not
    // pass vacuously behind a length>0 guard.
    const projectSelectCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('FROM projects') && sql.includes('WHERE id='),
    );
    expect(projectSelectCalls.length).toBeGreaterThanOrEqual(1);
    expect(projectSelectCalls[0][1][0]).toBe('proj-suggested');
  });

  it('JBB-002 — handles parsed_data delivered as a JSON string (not just object)', async () => {
    // Some drivers/paths return jsonb columns as a string. approve()/reject() already
    // parse the string form; persist must do the same so resolved_project_id is honored.
    const confirmarProcesado = jest.fn().mockResolvedValue(true);
    const asignarFacturaARendicion = jest.fn().mockResolvedValue(undefined);

    const queryMock = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('SELECT payload')) {
        return [{
          canal: null,
          source: 'whatsapp',
          email_from: null,
          payload: { from: '5492216205665' },
          // parsed_data as a JSON STRING, not an object.
          parsed_data: JSON.stringify({ resolved_project_id: 'proj-resolved' }),
        }];
      }
      if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-adrl' }];
      if (sql.includes('FROM projects WHERE id=')) return [{ name: 'Resolved Project' }];
      if (sql.includes('FROM promoters')) return [{ id: 'persona-1' }];
      return [];
    });

    const makeQueryRunner = () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    });

    const ds = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    const processor = new PersistProcessor(
      ds,
      { exportInvoice: jest.fn().mockResolvedValue(undefined) } as any,
      { asignarFacturaARendicion } as any,
      { confirmarProcesado } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() } as any,
    );

    const job = {
      data: {
        evento_crudo_id: 'evt-str',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: 'proj-other',
          datos_extraidos: { monto_total: 5000, moneda: 'CLP', razon_social_emisor: 'Proveedor X' },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    // resolved_project_id parsed from the string wins over proyecto_id_sugerido.
    expect(asignarFacturaARendicion).toHaveBeenCalled();
    expect(asignarFacturaARendicion.mock.calls[0][3]).toBe('proj-resolved');
  });

  it('B06 — resolved_project_id used over payload.project_id for rendición', async () => {
    const { processor, asignarFacturaARendicion } = buildProcessorWithResolvedId({
      resolvedProjectId: 'proj-resolved',
      payloadProjectId: 'proj-from-payload',
    });

    const job = {
      data: {
        evento_crudo_id: 'evt-adrl2',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          // No proyecto_id_sugerido set
          datos_extraidos: {
            monto_total: 2000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor Z',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    expect(asignarFacturaARendicion).toHaveBeenCalled();
    const rendicionArgs = asignarFacturaARendicion.mock.calls[0];
    expect(rendicionArgs[3]).toBe('proj-resolved');
    expect(rendicionArgs[3]).not.toBe('proj-from-payload');
  });
});

// ─── SLICE C — C01/C02: NUEVO offer set after single_active_project confirmation ─
//
// HONEST LIMITATION (spec R-14(d)/SCENARIO-18):
// When resolver_method='single_active_project', the comprobante (invoice/rendición)
// is ALREADY committed by the time the NUEVO offer is sent. NUEVO can only re-point
// the evento + create a draft; it does NOT move the already-persisted invoice.
// The offer session carries facturaId (the already-persisted invoice id) precisely
// so the create flow can document sub-case 2 in raw_content.reassign_factura_id on
// the draft, and the confirmation message remains honest (no claim of moving it).
describe('PersistProcessor — Slice C: NUEVO offer (C01/C02)', () => {
  /**
   * Build a processor with a minimal WhatsAppSessionService mock (sessions.set spy)
   * and a query mock that supports the single_active_project happy path.
   *
   * The processor constructor now takes a 5th argument: WhatsAppSessionService.
   * `classification.resolver_method` drives the offer.
   */
  function buildProcessorWithSessions(opts: {
    resolverMethod?: string;
    phone?: string;
    invoiceId?: string;
    canCreate?: boolean; // true = MANAGER user found
    language?: 'en' | 'es'; // language of the MANAGER user (drives nuevoLine wording)
  } = {}) {
    const { resolverMethod = 'single_active_project', phone = '5492216205665', invoiceId = 'inv-solo', canCreate = true, language = 'es' } = opts;

    const sessionSet = jest.fn().mockResolvedValue(undefined);
    const sessionGet = jest.fn().mockResolvedValue(null);
    const sessionsMock = { get: sessionGet, set: sessionSet, delete: jest.fn() };

    const confirmarProcesado = jest.fn().mockResolvedValue(true);

    const queryMock = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('SELECT payload')) {
        return [{
          canal: null,
          source: 'whatsapp',
          email_from: null,
          payload: { from: phone },
          parsed_data: null,
        }];
      }
      if (sql.includes('INSERT INTO invoices')) return [{ id: invoiceId }];
      if (sql.includes('FROM projects WHERE id=')) return [{ name: 'Proyecto Solo' }];
      // canCreate inline query: MANAGER check (also carries language for nuevoLine wording)
      if (sql.includes("role = 'MANAGER'")) {
        return canCreate ? [{ id: 'user-mgr', language }] : [];
      }
      // resolvePersonaId
      if (sql.includes('FROM promoters')) return [{ id: 'persona-1' }];
      return [];
    });

    const makeQueryRunner = () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    });

    const ds = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    const processor = new PersistProcessor(
      ds,
      { exportInvoice: jest.fn().mockResolvedValue(undefined) } as any,
      { asignarFacturaARendicion: jest.fn().mockResolvedValue(undefined) } as any,
      { confirmarProcesado } as any,
      sessionsMock as any,
    );

    return { processor, queryMock, confirmarProcesado, sessionSet, sessionGet };
  }

  function makeSingleActiveProjectJob(opts: { invoiceId?: string; resolverMethod?: string } = {}): any {
    return {
      data: {
        evento_crudo_id: 'ec-solo',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.95,
          proyecto_id_sugerido: 'proj-solo',
          resolver_method: opts.resolverMethod ?? 'single_active_project',
          datos_extraidos: {
            monto_total: 5000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor Solo',
          },
        },
      },
    };
  }

  it('C01 — appends Spanish NUEVO escape line for a Spanish MANAGER (ES)', async () => {
    const { processor, confirmarProcesado } = buildProcessorWithSessions({ canCreate: true, language: 'es' });
    const job = makeSingleActiveProjectJob();

    await processor.process(job);

    expect(confirmarProcesado).toHaveBeenCalledTimes(1);
    const opts = confirmarProcesado.mock.calls[0][0];
    // Spanish MANAGER → Spanish wording, and NOT the English branch.
    expect(opts.nuevoLine).toMatch(/NUEVO/);
    expect(opts.nuevoLine).toMatch(/otro proyecto/i);
    expect(opts.nuevoLine).not.toMatch(/different project/i);
    expect(opts.nuevoLine).not.toMatch(/reply NEW/i);
  });

  it('C01 — appends English NUEVO escape line for an English MANAGER (EN)', async () => {
    // Language resolution mirrors getUserLanguageForCreate: MANAGER row carries language='en'.
    // This guards against an EN/ES swap (same bug class as Slice A) by asserting the
    // English branch is genuinely English and contains no Spanish wording.
    const { processor, confirmarProcesado } = buildProcessorWithSessions({ canCreate: true, language: 'en' });
    const job = makeSingleActiveProjectJob();

    await processor.process(job);

    const opts = confirmarProcesado.mock.calls[0][0];
    expect(opts.nuevoLine).toMatch(/different project/i);
    expect(opts.nuevoLine).toMatch(/reply NEW/i);
    expect(opts.nuevoLine).not.toMatch(/NUEVO/);
    expect(opts.nuevoLine).not.toMatch(/otro proyecto/i);
  });

  it('C02 — sets project_create_offer session after confirmation with state=awaiting_clarification (ADR-11)', async () => {
    const { processor, sessionSet } = buildProcessorWithSessions({ canCreate: true });
    const job = makeSingleActiveProjectJob();

    await processor.process(job);

    // session.set MUST have been called with a project_create_offer clarification
    const offerSetCall = sessionSet.mock.calls.find((args: any[]) => {
      const session = args[1];
      return session?.clarification?.type === 'project_create_offer';
    });
    expect(offerSetCall).toBeDefined();
    const savedSession = offerSetCall[1];
    // ADR-11: state MUST be 'awaiting_clarification'
    expect(savedSession.state).toBe('awaiting_clarification');
    // Must carry the evento id
    expect(savedSession.clarification.eventoCrudoId).toBe('ec-solo');
    // Must carry the auto-assigned project id
    expect(savedSession.clarification.autoAssignedProjectId).toBe('proj-solo');
  });

  it('C02 — facturaId is stored on the offer session (sub-case 2 detection)', async () => {
    const { processor, sessionSet } = buildProcessorWithSessions({ canCreate: true, invoiceId: 'inv-FAC-solo' });
    const job = makeSingleActiveProjectJob();

    await processor.process(job);

    const offerSetCall = sessionSet.mock.calls.find((args: any[]) => {
      return args[1]?.clarification?.type === 'project_create_offer';
    });
    expect(offerSetCall).toBeDefined();
    // facturaId = the invoice committed during this run (sub-case 2 — already persisted)
    expect(offerSetCall[1].clarification.facturaId).toBeDefined();
  });

  it('C01/C02 — NO offer when resolver_method != single_active_project (multi-project path)', async () => {
    const { processor, sessionSet, confirmarProcesado } = buildProcessorWithSessions({ canCreate: true });
    const job = makeSingleActiveProjectJob({ resolverMethod: 'keyword_match' });

    await processor.process(job);

    // confirmarProcesado still fires (whatsapp channel), but no nuevoLine
    expect(confirmarProcesado).toHaveBeenCalled();
    const opts = confirmarProcesado.mock.calls[0][0];
    expect(opts.nuevoLine ?? opts.extraLine).toBeUndefined();

    // No offer session set
    const offerSetCall = sessionSet.mock.calls.find((args: any[]) =>
      args[1]?.clarification?.type === 'project_create_offer',
    );
    expect(offerSetCall).toBeUndefined();
  });

  it('C01/C02 — NO offer when sender is not MANAGER (non-MANAGER gate)', async () => {
    const { processor, sessionSet, confirmarProcesado } = buildProcessorWithSessions({ canCreate: false });
    const job = makeSingleActiveProjectJob();

    await processor.process(job);

    expect(confirmarProcesado).toHaveBeenCalled();
    const opts = confirmarProcesado.mock.calls[0][0];
    expect(opts.nuevoLine ?? opts.extraLine).toBeUndefined();

    const offerSetCall = sessionSet.mock.calls.find((args: any[]) =>
      args[1]?.clarification?.type === 'project_create_offer',
    );
    expect(offerSetCall).toBeUndefined();
  });

  it('C01/C02 — NO offer when phone is unresolved (email channel, no phone)', async () => {
    const sessionSet = jest.fn().mockResolvedValue(undefined);
    const confirmarProcesado = jest.fn().mockResolvedValue(true);
    const queryMock = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('SELECT payload')) return [{ canal: 'email', source: 'email', email_from: 'x@y.com', payload: {}, parsed_data: null }];
      if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-1' }];
      return [];
    });

    const makeQR = () => ({ connect: jest.fn().mockResolvedValue(undefined), startTransaction: jest.fn().mockResolvedValue(undefined), commitTransaction: jest.fn().mockResolvedValue(undefined), rollbackTransaction: jest.fn().mockResolvedValue(undefined), release: jest.fn().mockResolvedValue(undefined), isTransactionActive: true, query: (sql: string, p?: any[]) => queryMock(sql, p) });
    const ds = { createQueryRunner: jest.fn(() => makeQR()), query: (sql: string, p?: any[]) => queryMock(sql, p) } as unknown as DataSource;
    const processor = new PersistProcessor(
      ds,
      { exportInvoice: jest.fn().mockResolvedValue(undefined) } as any,
      { asignarFacturaARendicion: jest.fn().mockResolvedValue(undefined) } as any,
      { confirmarProcesado } as any,
      { get: jest.fn(), set: sessionSet, delete: jest.fn() } as any,
    );

    const job = makeSingleActiveProjectJob();
    await processor.process(job);

    // No WA confirmation for email channel, no offer set
    expect(confirmarProcesado).not.toHaveBeenCalled();
    const offerSetCall = sessionSet.mock.calls.find((args: any[]) =>
      args[1]?.clarification?.type === 'project_create_offer',
    );
    expect(offerSetCall).toBeUndefined();
  });
});

describe('PersistProcessor — duplicate notification', () => {
  let processor: PersistProcessor;
  let queryMock: jest.Mock;
  let avisarDuplicado: jest.Mock;
  let confirmarProcesado: jest.Mock;

  beforeEach(() => {
    queryMock = jest.fn((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT payload')) {
        return Promise.resolve([
          { canal: null, source: 'whatsapp', email_from: null, payload: { from: '5492216205665' } },
        ]);
      }
      // Natural-key duplicate check hits an existing invoice.
      if (sql.includes('FROM invoices WHERE')) return Promise.resolve([{ id: 'existing-inv' }]);
      return Promise.resolve([]);
    });

    const makeQueryRunner = (): QueryRunner =>
      ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => queryMock(sql, params),
      }) as unknown as QueryRunner;

    const dataSource = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    avisarDuplicado = jest.fn().mockResolvedValue(true);
    confirmarProcesado = jest.fn().mockResolvedValue(true);

    processor = new PersistProcessor(
      dataSource,
      { exportInvoice: jest.fn() } as any,
      { asignarFacturaARendicion: jest.fn() } as any,
      { avisarDuplicado, confirmarProcesado } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() } as any,
    );
  });

  it('notifies the sender when the invoice already existed (no new confirmation)', async () => {
    const job = {
      data: {
        evento_crudo_id: 'evt-dup',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          confidence_score: 0.9,
          // Natural key present → duplicate check runs.
          datos_extraidos: { numero_documento: 'F-001', rut_emisor: '11.111.111-1', monto_total: 100 },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    expect(avisarDuplicado).toHaveBeenCalledWith('5492216205665');
    expect(confirmarProcesado).not.toHaveBeenCalled();
  });
});
