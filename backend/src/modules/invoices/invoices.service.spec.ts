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
