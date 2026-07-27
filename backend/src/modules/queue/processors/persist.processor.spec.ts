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
