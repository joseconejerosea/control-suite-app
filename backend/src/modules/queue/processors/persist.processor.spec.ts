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

// A2: invoices.project_id is resolved ATOMICALLY inside the INSERT via a tenant-scoped
// correlated subquery (SELECT id FROM projects WHERE id=$12 AND client_id=$1). The processor
// still normalizes any non-uuid project id (empty string, LLM-emitted project NAME, malformed
// id) to null in JS BEFORE the INSERT so $12 is uuid-or-null and never cast-errors. Downstream
// (rendición / confirmation / offer) reads the value the DB actually persisted, taken from the
// INSERT's `RETURNING project_id`. So load-bearing project ids in these tests must be canonical
// uuids, and every INSERT mock must ECHO params[11] as `project_id` to model "exists in tenant".
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_RESOLVED = '22222222-2222-4222-8222-222222222222';
const UUID_OTHER = '33333333-3333-4333-8333-333333333333';
const UUID_SUGGESTED = '44444444-4444-4444-8444-444444444444';
const UUID_PAYLOAD = '55555555-5555-4555-8555-555555555555';
const UUID_SOLO = '66666666-6666-4666-8666-666666666666';
const UUID_STALE = '77777777-7777-4777-8777-777777777777';

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
    queryMock = jest.fn((sql: string, params?: any[]) => {
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
      // A2: the INSERT now CONTAINS the correlated subquery `FROM projects`, so this branch
      // MUST precede any `FROM projects` name-lookup branch. Echo params[11] as project_id to
      // model "the project exists in this tenant" (subquery yields the id).
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ id: 'inv-1', project_id: params?.[11] ?? null }]);
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
          proyecto_id_sugerido: UUID_A,
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
    queryMock.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT payload')) {
        return Promise.resolve([
          { canal: 'email', source: 'email', email_from: 'a@b.com', payload: {} },
        ]);
      }
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ id: 'inv-1', project_id: params?.[11] ?? null }]);
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

    const queryMock = jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
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
      // A2: the INSERT CONTAINS the correlated subquery `FROM projects`, so it MUST be matched
      // BEFORE the name-lookup branch below. Echo params[11] as project_id to model "the project
      // exists in this tenant" — downstream (rendición/confirmation) reads this RETURNING value.
      if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-adrl', project_id: params?.[11] ?? null }];
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
      resolvedProjectId: UUID_RESOLVED,
      proyectoIdSugerido: UUID_OTHER,
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
          proyecto_id_sugerido: UUID_OTHER,
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
    expect(projectIdArg).toBe(UUID_RESOLVED);
    expect(projectIdArg).not.toBe(UUID_OTHER);
  });

  it('B07 — confirmation derivation uses resolved_project_id over proyecto_id_sugerido', async () => {
    const { processor, queryMock, confirmarProcesado } = buildProcessorWithResolvedId({
      resolvedProjectId: UUID_RESOLVED,
      proyectoIdSugerido: UUID_OTHER,
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
          proyecto_id_sugerido: UUID_OTHER,
          datos_extraidos: {
            monto_total: 5000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor X',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    // The SELECT FROM projects to get project name should use the resolved uuid, not the sugerido.
    // Restrict to the NAME lookup (has 'WHERE id=' but NOT the guard's client_id) so we do not
    // accidentally match the anchored tenant guard SELECT.
    const projectSelectCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.includes('FROM projects') &&
        sql.includes('WHERE id=') &&
        !sql.includes('client_id'),
    );
    expect(projectSelectCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = projectSelectCalls[0];
    expect(params[0]).toBe(UUID_RESOLVED);
    expect(params[0]).not.toBe(UUID_OTHER);
  });

  it('B06/B07 — null resolved_project_id → legacy behavior: proyecto_id_sugerido used', async () => {
    const { processor, asignarFacturaARendicion, queryMock } = buildProcessorWithResolvedId({
      resolvedProjectId: null,
      proyectoIdSugerido: UUID_SUGGESTED,
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
          proyecto_id_sugerido: UUID_SUGGESTED,
          datos_extraidos: {
            monto_total: 1000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor Y',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    // Rendición: projectId should be the sugerido uuid (legacy behavior)
    expect(asignarFacturaARendicion).toHaveBeenCalled();
    const rendicionArgs = asignarFacturaARendicion.mock.calls[0];
    expect(rendicionArgs[3]).toBe(UUID_SUGGESTED);

    // Confirmation: the FROM projects NAME lookup MUST have run with the legacy id.
    // JAB-002/JBB-006 — assert unconditionally: a regression that drops the
    // confirmation derivation (never selecting the project) must fail here, not
    // pass vacuously behind a length>0 guard. Exclude the anchored tenant guard SELECT.
    const projectSelectCalls = queryMock.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.includes('FROM projects') &&
        sql.includes('WHERE id=') &&
        !sql.includes('client_id'),
    );
    expect(projectSelectCalls.length).toBeGreaterThanOrEqual(1);
    expect(projectSelectCalls[0][1][0]).toBe(UUID_SUGGESTED);
  });

  it('JBB-002 — handles parsed_data delivered as a JSON string (not just object)', async () => {
    // Some drivers/paths return jsonb columns as a string. approve()/reject() already
    // parse the string form; persist must do the same so resolved_project_id is honored.
    const confirmarProcesado = jest.fn().mockResolvedValue(true);
    const asignarFacturaARendicion = jest.fn().mockResolvedValue(undefined);

    const queryMock = jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('SELECT payload')) {
        return [{
          canal: null,
          source: 'whatsapp',
          email_from: null,
          payload: { from: '5492216205665' },
          // parsed_data as a JSON STRING, not an object.
          parsed_data: JSON.stringify({ resolved_project_id: UUID_RESOLVED }),
        }];
      }
      // A2: INSERT (with subquery `FROM projects`) matched before the name lookup; echo params[11].
      if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-adrl', project_id: params?.[11] ?? null }];
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
          proyecto_id_sugerido: UUID_OTHER,
          datos_extraidos: { monto_total: 5000, moneda: 'CLP', razon_social_emisor: 'Proveedor X' },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    // resolved_project_id parsed from the string wins over proyecto_id_sugerido.
    expect(asignarFacturaARendicion).toHaveBeenCalled();
    expect(asignarFacturaARendicion.mock.calls[0][3]).toBe(UUID_RESOLVED);
  });

  it('B06 — resolved_project_id used over payload.project_id for rendición', async () => {
    const { processor, asignarFacturaARendicion } = buildProcessorWithResolvedId({
      resolvedProjectId: UUID_RESOLVED,
      payloadProjectId: UUID_PAYLOAD,
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
    expect(rendicionArgs[3]).toBe(UUID_RESOLVED);
    expect(rendicionArgs[3]).not.toBe(UUID_PAYLOAD);
  });

  // ─── A2 — persist resolved project onto invoices.project_id ────────────────
  // The INSERT INTO invoices previously omitted project_id, so every invoice
  // landed "sin asignar" (project_id = NULL) even when the resolver identified a
  // project. project_id is the 12th param (index 11) of the INSERT params array.
  //
  // Helper: locate the invoice INSERT among the mocked query calls and return its
  // project_id param.
  function invoiceInsertProjectId(queryMock: jest.Mock): unknown {
    const insertCall = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && /INSERT INTO invoices/.test(sql),
    );
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall;
    // Load-bearing: the INSERT SQL itself must carry the project_id column and resolve it
    // ATOMICALLY via the tenant-scoped correlated subquery, then RETURN the resolved value.
    // Pinning the SQL text makes a regression that drops any piece (subquery, tenant scope,
    // RETURNING project_id) fail here rather than silently.
    expect(sql).toContain('project_id');
    expect(sql).toContain('FROM projects WHERE id = $12');
    expect(sql).toContain('client_id = $1');
    expect(sql).toContain('RETURNING id, project_id');
    return params[11];
  }

  it('A2 — proyecto_id_sugerido (no resolved_project_id) is written to invoices.project_id', async () => {
    const { processor, queryMock } = buildProcessorWithResolvedId({
      resolvedProjectId: null,
    });

    const job = {
      data: {
        evento_crudo_id: 'evt-a2-sug',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: UUID_SUGGESTED,
          datos_extraidos: {
            monto_total: 5000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor X',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    expect(invoiceInsertProjectId(queryMock)).toBe(UUID_SUGGESTED);
  });

  it('A2 — resolved_project_id takes precedence over proyecto_id_sugerido in the INSERT', async () => {
    const { processor, queryMock } = buildProcessorWithResolvedId({
      resolvedProjectId: UUID_RESOLVED,
      proyectoIdSugerido: UUID_SUGGESTED,
    });

    const job = {
      data: {
        evento_crudo_id: 'evt-a2-res',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: UUID_SUGGESTED,
          datos_extraidos: {
            monto_total: 5000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor X',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    const projectId = invoiceInsertProjectId(queryMock);
    expect(projectId).toBe(UUID_RESOLVED);
    expect(projectId).not.toBe(UUID_SUGGESTED);
  });

  it('A2 — no resolved, no sugerido, no payload.project_id → invoices.project_id is null', async () => {
    const { processor, queryMock } = buildProcessorWithResolvedId({
      resolvedProjectId: null,
    });

    const job = {
      data: {
        evento_crudo_id: 'evt-a2-null',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          // No proyecto_id_sugerido
          datos_extraidos: {
            monto_total: 5000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor X',
          },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    expect(invoiceInsertProjectId(queryMock)).toBeNull();
  });

  it('A2 (R3-001) — a resolved project id absent for this tenant degrades to null (factura NOT lost)', async () => {
    // R3-001: invoices.project_id is a FK to projects(id). A stale/deleted/foreign id must not
    // FK-violate the INSERT and lose the factura. With the atomic design the INSERT resolves
    // project_id via a tenant-scoped correlated subquery; when the project does NOT exist for
    // this tenant the subquery yields NULL, so the row persists "sin asignar" and can never
    // FK-violate. The DB (via RETURNING project_id: null), NOT a JS guard, enforces this.
    const confirmarProcesado = jest.fn().mockResolvedValue(true);
    const asignarFacturaARendicion = jest.fn().mockResolvedValue(undefined);

    const queryMock = jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('SELECT payload')) {
        return [{
          canal: null,
          source: 'whatsapp',
          email_from: null,
          payload: { from: '5492216205665' },
          parsed_data: { resolved_project_id: UUID_STALE },
        }];
      }
      // INSERT: the subquery finds NO matching project for this tenant → RETURNING project_id
      // is null even though a valid uuid ($12 = UUID_STALE) was passed. This models the
      // "graceful sin asignar" path, now enforced by the DB, not by a JS guard.
      if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-stale', project_id: null }];
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
        evento_crudo_id: 'evt-a2-stale',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: UUID_STALE,
          datos_extraidos: {
            monto_total: 5000,
            moneda: 'CLP',
            razon_social_emisor: 'Proveedor X',
          },
        },
      },
    } as unknown as Job<any>;

    // The persist must NOT throw — graceful degradation, not a lost factura.
    await expect(processor.process(job)).resolves.not.toThrow();

    // params[11] still carries the valid uuid ($12): JS keeps it, the DB decides existence.
    expect(invoiceInsertProjectId(queryMock)).toBe(UUID_STALE);
    // Downstream reads the DB-resolved value (RETURNING project_id: null): rendición gets null.
    expect(asignarFacturaARendicion).toHaveBeenCalled();
    expect(asignarFacturaARendicion.mock.calls[0][3]).toBeNull();
    // And the confirmation shows "sin asignar" (no resolved project).
    expect(confirmarProcesado).toHaveBeenCalled();
    expect(confirmarProcesado.mock.calls[0][0].proyecto).toBe('sin asignar');
  });
});

// ─── A2 — factura is NEVER lost (atomic in-SQL project_id resolution) ────────
// A dual adversarial review found the prior guard+retry approach was BROKEN in production:
// a 23503 FK violation ABORTS the tenant transaction, so the retry INSERT fails with 25P02
// ("current transaction is aborted"), NOT 23503 → the retry is dead code and the factura is
// still lost (see project memory `no-catch-swallow-in-tx`). The fix removes the guard SELECT
// and the FK-retry entirely: the INSERT resolves project_id via a tenant-scoped correlated
// subquery (SELECT id FROM projects WHERE id=$12 AND client_id=$1), which can NEVER FK-violate
// (the value is drawn FROM projects) and is atomic (no TOCTOU). JS normalization still nulls
// non-uuid input so $12 is uuid-or-null and never cast-errors. These tests prove the factura is
// persisted (never thrown away) across the raw-LLM-input edge cases.
describe('PersistProcessor — A2: factura never lost', () => {
  // Locate the invoice INSERT among mocked calls and return its project_id param ($12 / index 11).
  function invoiceInsertProjectId(queryMock: jest.Mock): unknown {
    const insertCall = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && /INSERT INTO invoices/.test(sql),
    );
    expect(insertCall).toBeDefined();
    const [, params] = insertCall;
    return params[11];
  }

  /**
   * Build a processor whose queryMock returns sensible defaults. The INSERT echoes params[11]
   * as project_id to model "the tenant-scoped subquery found the project" (existence is decided
   * by the DB, not a JS guard). There is no guard SELECT and no FK-retry anymore.
   */
  function buildProcessor(opts: { resolvedProjectId?: string | null } = {}) {
    const { resolvedProjectId = null } = opts;

    const confirmarProcesado = jest.fn().mockResolvedValue(true);
    const asignarFacturaARendicion = jest.fn().mockResolvedValue(undefined);

    const queryMock = jest.fn().mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT payload')) {
        return Promise.resolve([{
          canal: null,
          source: 'whatsapp',
          email_from: null,
          payload: { from: '5492216205665' },
          parsed_data: resolvedProjectId !== null ? { resolved_project_id: resolvedProjectId } : null,
        }]);
      }
      // INSERT (with the subquery `FROM projects`) matched BEFORE the name lookup; echo params[11].
      if (sql.includes('INSERT INTO invoices')) {
        return Promise.resolve([{ id: 'inv-hard', project_id: params?.[11] ?? null }]);
      }
      if (sql.includes('FROM projects WHERE id=')) return Promise.resolve([{ name: 'Proyecto' }]);
      if (sql.includes('FROM promoters')) return Promise.resolve([{ id: 'persona-1' }]);
      return Promise.resolve([]);
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
      {
        confirmarProcesado,
        avisarDuplicado: jest.fn().mockResolvedValue(true),
        avisarFalloProcesamiento: jest.fn().mockResolvedValue(true),
      } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() } as any,
    );

    return { processor, queryMock, confirmarProcesado, asignarFacturaARendicion };
  }

  function makeJob(proyectoIdSugerido: string): any {
    return {
      data: {
        evento_crudo_id: 'evt-hard',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          categoria: 'insumos',
          confidence_score: 0.9,
          proyecto_id_sugerido: proyectoIdSugerido,
          datos_extraidos: { monto_total: 5000, moneda: 'CLP', razon_social_emisor: 'Proveedor X' },
        },
      },
    };
  }

  it('empty-string proyecto_id_sugerido → INSERT runs with project_id null, no throw', async () => {
    // '' is falsy: `??` does NOT skip it, so normalization uses `!projectId ||` to coerce '' → null
    // BEFORE the INSERT. $12 is thus null (never the empty string, which would cast-error at uuid).
    const { processor, queryMock } = buildProcessor({ resolvedProjectId: null });

    await expect(processor.process(makeJob(''))).resolves.not.toThrow();

    // INSERT ran with project_id = null (sin asignar), never ''.
    expect(invoiceInsertProjectId(queryMock)).toBeNull();

    // The evento was marked processed (not failed) — factura NOT lost.
    const processedWrite = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("status='processed'"),
    );
    expect(processedWrite).toBeDefined();
  });

  it('a project NAME (non-uuid) is normalized to null → INSERT gets null $12, no throw', async () => {
    // The LLM can emit a project NAME instead of an id. Normalization drops any non-uuid to null
    // so $12 is uuid-or-null and the subquery `id = $12` never cast-errors. The factura persists.
    const { processor, queryMock } = buildProcessor({ resolvedProjectId: null });

    await expect(processor.process(makeJob('Snack Pacifico'))).resolves.not.toThrow();

    // INSERT ran with project_id = null.
    expect(invoiceInsertProjectId(queryMock)).toBeNull();
    const processedWrite = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("status='processed'"),
    );
    expect(processedWrite).toBeDefined();
  });

  it('a valid uuid is passed as $12 and echoed back via RETURNING → downstream uses the resolved value', async () => {
    // When the subquery finds the project (mock echoes params[11]), assignedProjectId comes from
    // RETURNING project_id, and the rendición receives that resolved value.
    const { processor, queryMock, asignarFacturaARendicion } = buildProcessor({ resolvedProjectId: UUID_RESOLVED });

    await expect(processor.process(makeJob(UUID_RESOLVED))).resolves.not.toThrow();

    expect(invoiceInsertProjectId(queryMock)).toBe(UUID_RESOLVED);
    expect(asignarFacturaARendicion).toHaveBeenCalled();
    expect(asignarFacturaARendicion.mock.calls[0][3]).toBe(UUID_RESOLVED);
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

    const queryMock = jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
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
      // A2: INSERT (with subquery `FROM projects`) matched BEFORE the name lookup. Echo params[11]
      // so proj-solo survives to autoAssignedProjectId (C02) via RETURNING project_id.
      if (sql.includes('INSERT INTO invoices')) return [{ id: invoiceId, project_id: params?.[11] ?? null }];
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
          proyecto_id_sugerido: UUID_SOLO,
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
    expect(savedSession.clarification.autoAssignedProjectId).toBe(UUID_SOLO);
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
    const queryMock = jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return [];
      if (sql.includes('SELECT payload')) return [{ canal: 'email', source: 'email', email_from: 'x@y.com', payload: {}, parsed_data: null }];
      if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-1', project_id: params?.[11] ?? null }];
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

// ─── Tarea 8 (Matriz v1.4) — FIX: marca posible duplicado sin borrar ─────────
// El QA reportó doble-conteo de la MISMA boleta. La causa real (confirmada contra la
// DB de dev, NO la hipótesis "por-alcance proyecto" del informe): las DOS capas de
// dedup dependen de una llave que puede faltar —
//   1) content-hash: exige eventos_crudos.doc_sha256 (el OCR lo backfillea; puede ser NULL).
//   2) natural-key : sólo corre `if (datos.numero_documento && datos.rut_emisor)`.
// Cuando faltan AMBAS (foto sin hash + OCR sin folio/RUT), NINGUNA capa la caza y un
// reenvío crea una SEGUNDA factura. El FIX agrega una TERCERA capa SOFT: detecta un
// probable duplicado por vendor_name + amount + invoice_date y MARCA la factura
// (posible_duplicado=true) SIN borrarla — el humano revisa en el reporte. Estos tests
// prueban que la factura se INSERTA con el flag correcto según el tercer check.
//
// El INSERT lleva posible_duplicado como ÚLTIMA columna ($13 / params[12]); project_id
// sigue en $12 (params[11]) vía subquery, y RETURNING id, project_id no cambia.
function invoiceInsertPosibleDuplicado(queryMock: jest.Mock): unknown {
  const insertCall = queryMock.mock.calls.find(
    ([sql]: [string]) => typeof sql === 'string' && /INSERT INTO invoices/.test(sql),
  );
  expect(insertCall).toBeDefined();
  const [sql, params] = insertCall;
  // Load-bearing: la columna nueva viaja como último parámetro, sin tocar el resto.
  expect(sql).toContain('posible_duplicado');
  expect(sql).toContain('$13');
  expect(sql).toContain('RETURNING id, project_id');
  return params[12];
}

describe('PersistProcessor — Tarea 8 (fix): marca posible duplicado sin borrar', () => {
  function buildProcessor(softMatch: boolean) {
    const queryMock = jest.fn((sql: string, params?: any[]) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT payload')) {
        return Promise.resolve([
          { canal: null, source: 'whatsapp', email_from: null, payload: { from: '5492216205665' }, parsed_data: null },
        ]);
      }
      // Content-hash: NO hay otro evento con el mismo hash (esta foto entró sin doc_sha256).
      if (sql.includes('JOIN eventos_crudos dup')) return Promise.resolve([]);
      // Tercera capa SOFT: se distingue por `vendor_name=` (el natural-key usa numero_documento).
      if (sql.includes('FROM invoices WHERE') && sql.includes('vendor_name=')) {
        return Promise.resolve(softMatch ? [{ id: 'existing' }] : []);
      }
      // Natural-key: no debería ni consultarse (guard salteado); si corriera, no matchea.
      if (sql.includes('FROM invoices WHERE')) return Promise.resolve([]);
      if (sql.includes('INSERT INTO invoices')) return Promise.resolve([{ id: 'inv-dup-t8', project_id: params?.[11] ?? null }]);
      if (sql.includes('FROM promoters')) return Promise.resolve([{ id: 'persona-1' }]);
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

    const avisarDuplicado = jest.fn().mockResolvedValue(true);
    const confirmarProcesado = jest.fn().mockResolvedValue(true);
    const processor = new PersistProcessor(
      dataSource,
      { exportInvoice: jest.fn() } as any,
      { asignarFacturaARendicion: jest.fn() } as any,
      { avisarDuplicado, confirmarProcesado } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() } as any,
    );

    return { processor, queryMock, avisarDuplicado, confirmarProcesado };
  }

  function makeJob(): Job<any> {
    return {
      data: {
        evento_crudo_id: 'evt-t8',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          confidence_score: 0.9,
          // Boleta de Valparaíso del QA: SIN numero_documento ni rut_emisor (el OCR no los sacó).
          datos_extraidos: { monto_total: 3150, moneda: 'CLP', razon_social_emisor: 'I. MUNICIPALIDAD DE VALPARAÍSO', fecha_emision: '2026-08-25' },
        },
      },
    } as unknown as Job<any>;
  }

  it('cuando el tercer check MATCHEA → inserta la factura con posible_duplicado=true (no la borra)', async () => {
    const { processor, queryMock, avisarDuplicado } = buildProcessor(true);

    await processor.process(makeJob());

    // La factura SÍ se inserta (nada se pierde) pero MARCADA como posible duplicado.
    expect(invoiceInsertPosibleDuplicado(queryMock)).toBe(true);
    // No se descartó como duplicado duro (no markDuplicate): el evento queda 'processed'.
    expect(avisarDuplicado).not.toHaveBeenCalled();
    const dupUpdate = queryMock.mock.calls.find(([sql]: [string]) => String(sql).includes("processing_status_new='duplicate'"));
    expect(dupUpdate).toBeUndefined();
    const processedWrite = queryMock.mock.calls.find(([sql]: [string]) => String(sql).includes("status='processed'"));
    expect(processedWrite).toBeDefined();
  });

  it('cuando el tercer check NO matchea (vendor/monto/fecha distintos) → inserta normal, posible_duplicado=false', async () => {
    const { processor, queryMock, avisarDuplicado } = buildProcessor(false);

    await processor.process(makeJob());

    expect(invoiceInsertPosibleDuplicado(queryMock)).toBe(false);
    expect(avisarDuplicado).not.toHaveBeenCalled();
  });

  it('R3-002 · vendor "Unknown" (OCR sin proveedor) NO dispara el soft-check → sin falso positivo', async () => {
    // El mock MATCHEARÍA (softMatch=true), pero con vendor='Unknown' el soft-check ni se
    // consulta → dos boletas sin proveedor con mismo monto+fecha no se marcan (no se excluye
    // un gasto legítimo del total).
    const { processor, queryMock } = buildProcessor(true);
    const job = {
      data: {
        evento_crudo_id: 'evt-t8-unknown',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          confidence_score: 0.9,
          // SIN razon_social_emisor → vendorName cae a 'Unknown'.
          datos_extraidos: { monto_total: 3150, moneda: 'CLP', fecha_emision: '2026-08-25' },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    // El soft-check (SELECT por vendor_name=) NUNCA se consultó (guard 'Unknown').
    const softCall = queryMock.mock.calls.find(([sql]: [string]) => String(sql).includes('vendor_name='));
    expect(softCall).toBeUndefined();
    // La factura entra sin marca.
    expect(invoiceInsertPosibleDuplicado(queryMock)).toBe(false);
  });
});

describe('PersistProcessor — content-hash duplicate (T10)', () => {
  it('marca duplicate + avisa cuando otro evento PROCESADO tiene el mismo doc_sha256, SIN natural-key', async () => {
    const queryMock = jest.fn((sql: string, _params?: any[]) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('SELECT payload')) {
        return Promise.resolve([
          { canal: null, source: 'whatsapp', email_from: null, payload: { from: '5492216205665' } },
        ]);
      }
      // Dedup por CONTENIDO: el JOIN encuentra otro evento con el mismo hash.
      if (sql.includes('JOIN eventos_crudos dup')) return Promise.resolve([{ id: 'prior-evt' }]);
      // Natural-key NO matchea (aislamos el path del hash).
      if (sql.includes('FROM invoices WHERE')) return Promise.resolve([]);
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

    const avisarDuplicado = jest.fn().mockResolvedValue(true);
    const confirmarProcesado = jest.fn().mockResolvedValue(true);
    const processor = new PersistProcessor(
      dataSource,
      { exportInvoice: jest.fn() } as any,
      { asignarFacturaARendicion: jest.fn() } as any,
      { avisarDuplicado, confirmarProcesado } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() } as any,
    );

    const job = {
      data: {
        evento_crudo_id: 'evt-hashdup',
        client_id: 'client-1',
        processing_status: 'processed',
        classification: {
          tipo: 'factura_recibida',
          destino: 'gastos',
          confidence_score: 0.9,
          // Sin numero_documento/rut_emisor → el natural-key ni se evalúa; SOLO el hash caza.
          datos_extraidos: { monto_total: 100 },
        },
      },
    } as unknown as Job<any>;

    await processor.process(job);

    expect(avisarDuplicado).toHaveBeenCalledWith('5492216205665');
    expect(confirmarProcesado).not.toHaveBeenCalled();
    // NO insertó invoice.
    const insertCall = queryMock.mock.calls.find(([sql]: [string]) => String(sql).includes('INSERT INTO invoices'));
    expect(insertCall).toBeUndefined();
    // Marcó el evento como duplicate.
    const dupUpdate = queryMock.mock.calls.find(([sql]: [string]) => String(sql).includes("processing_status_new='duplicate'"));
    expect(dupUpdate).toBeDefined();
  });
});
