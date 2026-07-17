/// <reference types="jest" />
/**
 * Unit tests for AiExtractionService throw-site conversions (normalize-user-error-messages PR-2).
 *
 * L63 — !this.apiKey → AppException.config (was ServiceUnavailableException with raw env var text)
 * L69 — provider !== 'openai' → AppException.config (was ServiceUnavailableException with provider name)
 * L118 — OpenAI call throws → AppException.integration (was ServiceUnavailableException with raw message)
 */
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../../common/exceptions';
import { SAFE_MESSAGES } from '../../../common/exceptions';

// Mock the OpenAI SDK so extract() reaches its real try/catch at the network boundary
// without making a real API call. The mock constructor is controllable per-test via
// `openAiCreateMock`, letting us force the client.chat.completions.create() call to throw.
const openAiCreateMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: openAiCreateMock } },
  })),
}));

// Import AFTER jest.mock so the service picks up the mocked SDK.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { AiExtractionService } from './ai-extraction.service';

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    AI_API_KEY: undefined,
    AI_MODEL: 'gpt-4o-mini',
    AI_MAX_TOKENS: 4096,
    AI_PROVIDER: 'openai',
  };
  const merged = { ...defaults, ...overrides };
  return {
    get: jest.fn((key: string, fallback?: unknown) =>
      merged[key] !== undefined ? merged[key] : fallback,
    ),
  } as unknown as ConfigService;
}

describe('AiExtractionService — throw-site normalization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    openAiCreateMock.mockReset();
  });

  const INPUT = { text: 'some text', target_table: 'promoters' as const };

  // L63 — AI_API_KEY missing
  it('throws AppException.config (safe message) when AI_API_KEY is not set', async () => {
    const service = new AiExtractionService(makeConfig({ AI_API_KEY: undefined }));

    const err = await service.extract(INPUT).catch((e) => e);

    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.CONFIG_ERROR);
    // Raw env var name must NOT appear in userMessage
    expect((err as AppException).userMessage).not.toContain('AI_API_KEY');
    // Raw detail IS in technicalDetail
    expect((err as AppException).technicalDetail).toMatch(/AI_API_KEY|not configured/i);
    expect((err as AppException).getStatus()).toBe(503);
  });

  // L69 — unsupported provider
  it('throws AppException.config (safe message) when AI_PROVIDER is not openai', async () => {
    const service = new AiExtractionService(
      makeConfig({ AI_API_KEY: 'sk-test', AI_PROVIDER: 'anthropic' }),
    );

    const err = await service.extract(INPUT).catch((e) => e);

    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.CONFIG_ERROR);
    // Provider name must NOT appear in userMessage
    expect((err as AppException).userMessage).not.toContain('anthropic');
    expect((err as AppException).technicalDetail).toContain('anthropic');
    expect((err as AppException).getStatus()).toBe(503);
  });

  // L118 — The catch block in extract() converts any Error thrown by the OpenAI SDK
  // into AppException.integration. This exercises the REAL extract() method: config
  // passes the guards, `new OpenAI(...)` resolves to the mocked SDK, and the mocked
  // chat.completions.create() rejects — driving the real try/catch at the boundary.
  it('throws AppException.integration (safe message) when the OpenAI call throws', async () => {
    const service = new AiExtractionService(
      makeConfig({ AI_API_KEY: 'sk-test', AI_PROVIDER: 'openai' }),
    );

    openAiCreateMock.mockRejectedValueOnce(new Error('Connection error to OpenAI xyz'));

    const err = await service.extract(INPUT).catch((e) => e);

    // The real create() was invoked (proving we did not stub the method under test).
    expect(openAiCreateMock).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).userMessage).toBe(SAFE_MESSAGES.INTEGRATION_FAILURE);
    // Raw cause must NOT leak into the user-facing message
    expect((err as AppException).userMessage).not.toContain('Connection error');
    // Raw cause IS preserved in technicalDetail
    expect((err as AppException).technicalDetail).toContain('Connection error to OpenAI xyz');
    expect((err as AppException).getStatus()).toBe(503);
  });
});
