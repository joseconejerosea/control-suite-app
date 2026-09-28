/// <reference types="jest" />
/**
 * mail-ingestion.service.spec.ts
 *
 * Provider-agnostic pipeline tests. These are the ported GmailService unit tests,
 * retargeted to MailIngestionService with the SAME assertions. Provider-specific
 * assertions (OAuth scopes, exchange, message parsing) live in the provider specs.
 *
 * A fake MailboxProvider is injected — no googleapis, no network.
 */
import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MailIngestionService } from './mail-ingestion.service';
import { AppException } from '../../common/exceptions/app.exception';
import { MailboxProvider } from './mail-provider.interface';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../common/tenant/tenant-context', () => ({
  runWithTenant: (_ds: unknown, _clientId: string, fn: () => unknown) => fn(),
  runAsSystem: (fn: () => unknown) => fn(),
}));

const DEFAULT_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret',
  ANTHROPIC_API_KEY: 'ak',
};

function fakeProvider(overrides: Partial<MailboxProvider> = {}): MailboxProvider {
  return {
    id: 'gmail',
    isConfigured: () => true,
    assertConfigured: overrides.assertConfigured ?? jest.fn(),
    getAuthUrl: overrides.getAuthUrl ?? jest.fn().mockReturnValue('https://provider/auth'),
    exchangeCode:
      overrides.exchangeCode ??
      jest.fn().mockResolvedValue({ email: 'connected@acme.com', tokens: { access_token: 'a' } }),
    openSession: overrides.openSession ?? jest.fn(),
  } as MailboxProvider;
}

interface BuildOpts {
  env?: Record<string, string | undefined>;
  query?: jest.Mock;
  providers?: MailboxProvider[];
  createFromWebhook?: jest.Mock;
  notificar?: jest.Mock;
}

function build(opts: BuildOpts = {}) {
  const env = opts.env ?? DEFAULT_ENV;
  const config = { get: jest.fn((k: string) => env[k]) } as any;
  const query = opts.query ?? jest.fn().mockResolvedValue([]);
  const dataSource = { query } as any;
  const invoicesService = {
    createFromWebhook: opts.createFromWebhook ?? jest.fn().mockResolvedValue(undefined),
  } as any;
  const notifier = { notificar: opts.notificar ?? jest.fn().mockResolvedValue(undefined) } as any;
  const providers = opts.providers ?? [fakeProvider()];

  const service = new MailIngestionService(config, dataSource, invoicesService, notifier, providers);
  return { service, config, query, invoicesService, notifier, providers };
}

function signState(payload: Record<string, unknown>, secret = 'test-secret'): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.clearAllMocks());

// ─── getAuthUrl (delegates config gate + URL to the provider) ─────────────────

describe('MailIngestionService · getAuthUrl', () => {
  it('no tenant context → UnauthorizedException', () => {
    const { service } = build();
    expect(() => service.getAuthUrl('gmail', '')).toThrow(UnauthorizedException);
  });

  it('unknown provider → UnauthorizedException', () => {
    const { service } = build();
    expect(() => service.getAuthUrl('outlook', 'client-1')).toThrow(/Unsupported mail provider/);
  });

  it('provider not configured → AppException(config, 503) propagates', () => {
    const throwing = fakeProvider({
      assertConfigured: jest.fn(() => {
        throw AppException.config('Gmail OAuth no configurado: faltan env vars [GMAIL_CLIENT_ID]', 503);
      }),
    });
    const { service } = build({ providers: [throwing] });
    try {
      service.getAuthUrl('gmail', 'client-1');
      fail('expected AppException');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).getStatus()).toBe(503);
    }
  });

  it('configured → returns provider URL and passes a signed state that verifies to the tenant', () => {
    const provider = fakeProvider();
    const { service } = build({ providers: [provider] });
    const url = service.getAuthUrl('gmail', 'client-1');

    expect(url).toBe('https://provider/auth');
    const state = (provider.getAuthUrl as jest.Mock).mock.calls[0][0];
    expect(state).toMatch(/^[\w-]+\.[\w-]+$/);
    expect((service as any).verifyState(state).clientId).toBe('client-1');
  });
});

// ─── CSRF signed state ───────────────────────────────────────────────────────

describe('MailIngestionService · CSRF state', () => {
  it('round-trips the clientId', () => {
    const { service } = build();
    const state = (service as any).buildState('client-xyz', 'gmail');
    expect((service as any).verifyState(state).clientId).toBe('client-xyz');
  });

  it('missing JWT_SECRET → buildState throws', () => {
    const { service } = build({ env: { ...DEFAULT_ENV, JWT_SECRET: undefined } });
    expect(() => (service as any).buildState('client-1', 'gmail')).toThrow(/JWT_SECRET/);
  });

  it('empty / malformed → UnauthorizedException', () => {
    const { service } = build();
    expect(() => (service as any).verifyState('')).toThrow(UnauthorizedException);
    expect(() => (service as any).verifyState('no-dot')).toThrow(UnauthorizedException);
  });

  it('tampered signature → UnauthorizedException', () => {
    const { service } = build();
    const valid: string = (service as any).buildState('client-1', 'gmail');
    const [body, sig] = valid.split('.');
    const tampered = `${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    expect(() => (service as any).verifyState(tampered)).toThrow(UnauthorizedException);
  });

  it('expired → UnauthorizedException even with a valid signature', () => {
    const { service } = build();
    const expired = signState({ c: 'client-1', p: 'gmail', n: 'abc', e: Date.now() - 1000 });
    expect(() => (service as any).verifyState(expired)).toThrow(/expired/i);
  });

  it('foreign secret → mismatch', () => {
    const { service } = build();
    const forged = signState({ c: 'attacker', p: 'gmail', n: 'x', e: Date.now() + 60_000 }, 'other-secret');
    expect(() => (service as any).verifyState(forged)).toThrow(UnauthorizedException);
  });
});

// ─── handleCallback ──────────────────────────────────────────────────────────

describe('MailIngestionService · handleCallback', () => {
  it('valid state → exchanges via provider and upserts tokens for the tenant', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const provider = fakeProvider();
    const { service } = build({ query, providers: [provider] });
    const state = (service as any).buildState('client-1', 'gmail');

    const email = await service.handleCallback('gmail', 'auth-code', state);

    expect(email).toBe('connected@acme.com');
    expect(provider.exchangeCode).toHaveBeenCalledWith('auth-code');
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO gmail_tokens/.test(sql));
    expect(insert).toBeDefined();
    expect(insert![1]).toEqual(['connected@acme.com', expect.any(String), 'client-1', 'gmail']);
  });

  it('bad state → UnauthorizedException before any exchange', async () => {
    const provider = fakeProvider();
    const { service } = build({ providers: [provider] });
    await expect(service.handleCallback('gmail', 'auth-code', 'bogus')).rejects.toThrow(UnauthorizedException);
    expect(provider.exchangeCode).not.toHaveBeenCalled();
  });
});

// ─── statusForTenant / disconnectTenant ──────────────────────────────────────

describe('MailIngestionService · statusForTenant', () => {
  it('no clientId → not connected', async () => {
    const { service } = build();
    expect(await service.statusForTenant('')).toEqual({ connected: false, accounts: [] });
  });

  it('rows present → connected with account list', async () => {
    const query = jest.fn().mockResolvedValue([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
    const { service } = build({ query });
    expect(await service.statusForTenant('c1')).toEqual({ connected: true, accounts: ['a@x.com', 'b@x.com'] });
  });

  it('query rejects → best-effort empty', async () => {
    const query = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = build({ query });
    expect(await service.statusForTenant('c1')).toEqual({ connected: false, accounts: [] });
  });
});

describe('MailIngestionService · disconnectTenant', () => {
  it('no clientId → UnauthorizedException', async () => {
    const { service } = build();
    await expect(service.disconnectTenant('')).rejects.toThrow(UnauthorizedException);
  });

  it('deletes tokens and reports removed count', async () => {
    const query = jest.fn().mockResolvedValue([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
    const { service } = build({ query });
    expect(await service.disconnectTenant('c1')).toEqual({ ok: true, removed: 2 });
  });

  it('nothing to remove → removed 0', async () => {
    const { service } = build({ query: jest.fn().mockResolvedValue([]) });
    expect(await service.disconnectTenant('c1')).toEqual({ ok: true, removed: 0 });
  });
});

// ─── loadTokensForClient ─────────────────────────────────────────────────────

describe('MailIngestionService · loadTokensForClient', () => {
  it('no rows → null', async () => {
    const { service } = build({ query: jest.fn().mockResolvedValue([]) });
    expect(await service.loadTokensForClient('c1', 'a@x.com')).toBeNull();
  });

  it('string tokens → parsed', async () => {
    const query = jest.fn().mockResolvedValue([{ tokens: '{"access_token":"tok"}' }]);
    const { service } = build({ query });
    expect(await service.loadTokensForClient('c1', 'a@x.com')).toEqual({ access_token: 'tok' });
  });

  it('object tokens → as-is', async () => {
    const query = jest.fn().mockResolvedValue([{ tokens: { access_token: 'tok' } }]);
    const { service } = build({ query });
    expect(await service.loadTokensForClient('c1', 'a@x.com')).toEqual({ access_token: 'tok' });
  });

  it('query throws → null', async () => {
    const query = jest.fn().mockRejectedValue(new Error('db'));
    const { service } = build({ query });
    expect(await service.loadTokensForClient('c1', 'a@x.com')).toBeNull();
  });
});

// ─── staff gate (fail-closed) ────────────────────────────────────────────────

describe('MailIngestionService · isAuthorizedInvoiceSender', () => {
  it('empty email → false without DB', async () => {
    const query = jest.fn();
    const { service } = build({ query });
    expect(await (service as any).isAuthorizedInvoiceSender('c1', '')).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('staff row → true (email lowercased)', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const { service } = build({ query });
    expect(await (service as any).isAuthorizedInvoiceSender('c1', 'Staff@X.com')).toBe(true);
    expect(query.mock.calls[0][1]).toEqual(['c1', 'staff@x.com']);
  });

  it('no row → false', async () => {
    const { service } = build({ query: jest.fn().mockResolvedValue([]) });
    expect(await (service as any).isAuthorizedInvoiceSender('c1', 'x@y.com')).toBe(false);
  });

  it('DB error → false (fail-closed)', async () => {
    const query = jest.fn().mockRejectedValue(new Error('db'));
    const { service } = build({ query });
    expect(await (service as any).isAuthorizedInvoiceSender('c1', 'x@y.com')).toBe(false);
  });
});

// ─── pure helpers ────────────────────────────────────────────────────────────

describe('MailIngestionService · parsing helpers', () => {
  it('extractEmailAddress strips the display name', () => {
    const { service } = build();
    expect((service as any).extractEmailAddress('Jose Perez <jose@acme.com>')).toBe('jose@acme.com');
    expect((service as any).extractEmailAddress('jose@acme.com')).toBe('jose@acme.com');
  });

  it('extractSubjectToken pulls [#token] lowercased, else null', () => {
    const { service } = build();
    expect((service as any).extractSubjectToken('Re: Informe [#Ab12Cd]')).toBe('ab12cd');
    expect((service as any).extractSubjectToken('Re: Informe sin token')).toBeNull();
  });

  it('buildIncidenciaDescripcion: subject + trimmed body', () => {
    const { service } = build();
    expect((service as any).buildIncidenciaDescripcion({ subject: 'Asunto', body: '  cuerpo  ' }))
      .toBe('Asunto\n\ncuerpo');
  });
});

// ─── pollAllClients reentrancy guard ─────────────────────────────────────────

describe('MailIngestionService · pollAllClients reentrancy', () => {
  it('overlapping runs skip the second — the token SELECT fires only once', async () => {
    let resolveSelect: (rows: any[]) => void = () => undefined;
    const query = jest.fn((sql: string) => {
      if (/gmail_tokens WHERE tokens IS NOT NULL/.test(sql)) {
        // Primer SELECT queda pendiente hasta que lo resolvamos → mantiene el
        // primer poll in-flight mientras disparamos el segundo.
        return new Promise((res) => { resolveSelect = res; });
      }
      return Promise.resolve([]);
    });
    const { service } = build({ query });

    const p1 = service.pollAllClients();
    const p2 = service.pollAllClients(); // debería saltarse por el guard

    resolveSelect([]); // libera el primer poll
    await Promise.all([p1, p2]);

    const selectCalls = query.mock.calls.filter(([sql]) =>
      /gmail_tokens WHERE tokens IS NOT NULL/.test(sql),
    );
    expect(selectCalls).toHaveLength(1);
  });
});

// ─── pollInbox / markEmailProcessed ──────────────────────────────────────────

describe('MailIngestionService · pollInbox / markEmailProcessed', () => {
  it('no tokens → short-circuits without opening a session', async () => {
    const provider = fakeProvider();
    const { service } = build({ providers: [provider] });
    expect(await service.pollInbox('gmail', 'c1')).toEqual({ checked: 0, saved: 0 });
    expect(provider.openSession).not.toHaveBeenCalled();
  });

  it('session refreshed its tokens → persists them back (Outlook depends on this)', async () => {
    let refreshed = false;
    const session = {
      listRecentIds: jest.fn(async () => {
        refreshed = true;
        return [];
      }),
      getMessage: jest.fn(),
      getAttachmentBase64: jest.fn(),
      currentTokens: jest.fn(() => (refreshed ? { access_token: 'new' } : { access_token: 'old' })),
    };
    const provider = fakeProvider({ openSession: jest.fn().mockReturnValue(session) });
    const query = jest.fn().mockResolvedValue([]);
    const { service } = build({ providers: [provider], query });

    await service.pollInbox('gmail', 'c1', 'a@x.com', { access_token: 'old' });

    const update = query.mock.calls.find(([sql]) => /UPDATE gmail_tokens SET tokens/.test(sql));
    expect(update).toBeDefined();
    expect(update![1]).toEqual([JSON.stringify({ access_token: 'new' }), 'c1', 'a@x.com', 'gmail']);
  });

  it('JDB-R2-001: transient attachment failure + terminal "no invoice" text → NOT marked (retries)', async () => {
    const session = {
      listRecentIds: jest.fn().mockResolvedValue(['m1']),
      getMessage: jest.fn().mockResolvedValue({
        id: 'm1', subject: 'Factura', from: 'Staff <staff@x.com>',
        body: 'cuerpo del correo', attachments: [{ id: 'a1', mimeType: 'application/pdf' }],
      }),
      getAttachmentBase64: jest.fn().mockResolvedValue('base64data'),
      currentTokens: jest.fn().mockReturnValue({ access_token: 'a' }),
    };
    const provider = fakeProvider({ openSession: jest.fn().mockReturnValue(session) });
    // staff gate → authorized; every other SELECT (seen/exists/matchReporte) → empty.
    const query = jest.fn().mockImplementation(async (sql: string) =>
      /FROM users/.test(sql) ? [{ '?column?': 1 }] : [],
    );

    // 1st fetch = document extraction → transient HTTP failure (→ null, retry).
    // 2nd fetch = text extraction → clean "not an invoice" (terminal).
    let calls = 0;
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 500 } as any;
      return { ok: true, json: async () => ({ content: [{ text: '{"is_invoice":false}' }] }) } as any;
    }) as any;

    const { service } = build({ providers: [provider], query });
    try {
      await service.pollInbox('gmail', 'c1', 'staff@x.com', { access_token: 'a' });
    } finally {
      global.fetch = realFetch;
    }

    // The transient attachment failure must NOT be masked by the terminal text result:
    // the email stays unmarked so the next poll retries it (invoice not lost).
    const marked = query.mock.calls.find(([sql]) => /INSERT INTO gmail_processed_emails/.test(sql));
    expect(marked).toBeUndefined();
  });

  it('markEmailProcessed: upserts ON CONFLICT DO NOTHING', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const { service } = build({ query });
    await (service as any).markEmailProcessed('c1', 'gmail', 'msg-42', 'invoice');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO gmail_processed_emails/);
    expect(sql).toMatch(/ON CONFLICT .* DO NOTHING/s);
    expect(params).toEqual(['c1', 'gmail', 'msg-42', 'invoice']);
  });

  it('markEmailProcessed: swallows DB errors', async () => {
    const query = jest.fn().mockRejectedValue(new Error('db'));
    const { service } = build({ query });
    await expect((service as any).markEmailProcessed('c1', 'gmail', 'g', 'ignored')).resolves.toBeUndefined();
  });
});
