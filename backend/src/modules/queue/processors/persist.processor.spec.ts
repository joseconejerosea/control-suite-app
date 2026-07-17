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
