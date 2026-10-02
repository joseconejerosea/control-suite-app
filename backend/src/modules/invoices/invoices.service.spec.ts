/// <reference types="jest" />
/**
 * Unit tests for InvoicesService throw-site conversions (normalize-user-error-messages PR-2).
 * Verifies that integration/config exceptions produced by extractFromImage use AppException
 * and carry a safe Spanish userMessage while raw technical detail is in technicalDetail.
 */
import { DataSource } from 'typeorm';
import { InvoicesService } from './invoices.service';
import { AppException } from '../../common/exceptions';
import { SAFE_MESSAGES } from '../../common/exceptions';

// Minimal stub for @InjectQueue — Queue is not exercised in these tests.
const queueStub = { add: jest.fn() };

function makeService(apiKey?: string): InvoicesService {
  const ds = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn().mockReturnValue({
      createQueryBuilder: jest.fn(),
    }),
  } as unknown as DataSource;

  // Temporarily override env so InvoicesService picks it up through process.env
  if (apiKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }

  return new InvoicesService(ds, queueStub as any);
}

describe('InvoicesService — extractFromImage throw-site normalization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  // L313 — ANTHROPIC_API_KEY missing → AppException.config (was BadRequestException)
  it('throws AppException.config when ANTHROPIC_API_KEY is not set', async () => {
    const service = makeService(undefined);

    const err = await service
      .extractFromImage('client-1', 'base64data', 'image/png')
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.CONFIG_ERROR);
    expect((err as AppException).technicalDetail).toMatch(/ANTHROPIC_API_KEY/i);
    expect((err as AppException).getStatus()).toBe(500);
  });

  // L336 — Anthropic API responded with !response.ok → AppException.integration (was BadRequestException)
  it('throws AppException.integration when the Anthropic API returns a non-ok response', async () => {
    const service = makeService('test-key');

    // Stub global fetch to return a non-ok response
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'rate limited' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const err = await service
      .extractFromImage('client-1', 'base64data', 'image/png')
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
    // Raw Anthropic status must NOT leak into the user-facing message
    expect((err as AppException).userMessage).not.toContain('429');
    expect((err as AppException).userMessage).not.toContain('rate limited');
    expect((err as AppException).technicalDetail).toMatch(/429/);
    expect((err as AppException).getStatus()).toBe(502);
  });

  // L376 — catch-all for unexpected errors → AppException.integration (was BadRequestException)
  it('throws AppException.integration for unexpected fetch errors in extractFromImage', async () => {
    const service = makeService('test-key');

    const fetchMock = jest.fn().mockRejectedValue(new Error('network failure xyz'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const err = await service
      .extractFromImage('client-1', 'base64data', 'image/png')
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
    expect((err as AppException).userMessage).not.toContain('network failure xyz');
    expect((err as AppException).technicalDetail).toContain('network failure xyz');
    expect((err as AppException).getStatus()).toBe(502);
  });
});

// ─── Tarea 8 (Matriz v1.4) — buildSummary excluye posibles duplicados del total ──
// El fix marca (posible_duplicado=true) las boletas que la dedup dura no cazó. El reporte
// las EXCLUYE del total pero las sigue mostrando en `rows` y las reporta aparte en
// dup_excluidos_count / dup_excluidos_amount. buildSummary es privado; lo ejercitamos vía
// getReport, que corre buildSummary para las tres categorías (la categoría llega en $2).
describe('InvoicesService — Tarea 8: buildSummary excluye posibles duplicados del total', () => {
  function makeServiceWithRows(rowsByCategory: Record<string, any[]>) {
    const queryMock = jest.fn((_sql: string, params?: any[]) =>
      Promise.resolve(rowsByCategory[params?.[1] as string] ?? []),
    );
    const ds = {
      query: queryMock,
      // El constructor de InvoicesService crea un TenantRepository que llama getRepository.
      getRepository: jest.fn().mockReturnValue({ createQueryBuilder: jest.fn() }),
    } as unknown as DataSource;
    const service = new InvoicesService(ds, queueStub as any);
    return { service, queryMock };
  }

  it('total suma SOLO las filas no marcadas; las marcadas van a dup_excluidos_* y siguen en rows', async () => {
    const expenseRows = [
      { id: 'a', amount: '10000', posible_duplicado: false, category: 'expense', invoice_date: '2026-08-25', vendor_name: 'X', currency: 'CLP', source: 'whatsapp', description: null, status: 'pending', created_at: '2026-08-25' },
      { id: 'b', amount: '18000', posible_duplicado: true,  category: 'expense', invoice_date: '2026-08-25', vendor_name: 'Uber', currency: 'CLP', source: 'whatsapp', description: null, status: 'pending', created_at: '2026-08-25' },
      { id: 'c', amount: '5000',  posible_duplicado: false, category: 'expense', invoice_date: '2026-08-25', vendor_name: 'Y', currency: 'CLP', source: 'manual', description: null, status: 'pending', created_at: '2026-08-25' },
    ];
    const { service } = makeServiceWithRows({ expense: expenseRows, sale: [], cost: [] });

    const report = await service.getReport('client-1');
    const exp = report.expenses;

    // Total EXCLUYE la fila marcada (18000): 10000 + 5000 = 15000.
    expect(exp.total_amount).toBe(15000);
    expect(exp.total_count).toBe(2);
    expect(exp.by_category[0].total).toBe(15000);
    expect(exp.by_category[0].count).toBe(2);

    // La marcada se reporta aparte.
    expect(exp.dup_excluidos_count).toBe(1);
    expect(exp.dup_excluidos_amount).toBe(18000);

    // Pero SIGUE visible en rows (3 filas), con su flag.
    expect(exp.rows).toHaveLength(3);
    expect(exp.rows.find(r => r.id === 'b')?.posible_duplicado).toBe(true);
  });

  it('sin filas marcadas → dup_excluidos_* en 0 y el total es completo', async () => {
    const saleRows = [
      { id: 's1', amount: '1000', posible_duplicado: false, category: 'sale', invoice_date: '2026-08-25', vendor_name: 'C', currency: 'CLP', source: 'manual', description: null, status: 'approved', created_at: '2026-08-25' },
      { id: 's2', amount: '2000', posible_duplicado: false, category: 'sale', invoice_date: '2026-08-25', vendor_name: 'D', currency: 'CLP', source: 'manual', description: null, status: 'approved', created_at: '2026-08-25' },
    ];
    const { service } = makeServiceWithRows({ sale: saleRows, cost: [], expense: [] });

    const report = await service.getReport('client-1');
    const sales = report.sales;

    expect(sales.total_amount).toBe(3000);
    expect(sales.total_count).toBe(2);
    expect(sales.dup_excluidos_count).toBe(0);
    expect(sales.dup_excluidos_amount).toBe(0);
    expect(sales.rows.every(r => r.posible_duplicado === false)).toBe(true);
  });
});
