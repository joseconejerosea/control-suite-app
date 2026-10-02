/// <reference types="jest" />
/**
 * outlook.provider.spec.ts
 *
 * Outlook / Microsoft Graph provider over mocked global fetch. Covers OAuth
 * (authorize URL, code exchange), message access (list / get / attachment) and —
 * critically for "complete" Outlook — token refresh: expiry-driven refresh and
 * 401 retry, with refreshed tokens surfaced via currentTokens().
 */
import { Logger } from '@nestjs/common';
import { OutlookProvider } from './outlook.provider';
import { AppException } from '../../../common/exceptions/app.exception';

const FULL_ENV: Record<string, string> = {
  OUTLOOK_CLIENT_ID: 'oc-id',
  OUTLOOK_CLIENT_SECRET: 'oc-secret',
  OUTLOOK_REDIRECT_URI: 'https://api.example.com/api/auth/outlook/callback',
};

function makeProvider(env: Record<string, string | undefined> = FULL_ENV) {
  const config = { get: jest.fn((k: string) => env[k]) } as any;
  return new OutlookProvider(config);
}

function jsonRes(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

type Route = [string, (url: string, init: any) => any];
function routeFetch(routes: Route[]) {
  return jest.fn(async (url: string, init: any) => {
    for (const [needle, handler] of routes) {
      if (String(url).includes(needle)) return handler(String(url), init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const realFetch = global.fetch;
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

describe('OutlookProvider · config gate', () => {
  it('isConfigured reflects env presence', () => {
    expect(makeProvider().isConfigured()).toBe(true);
    expect(makeProvider({ OUTLOOK_CLIENT_ID: 'x' }).isConfigured()).toBe(false);
  });

  it('assertConfigured missing vars → AppException(config, 503) naming them', () => {
    const provider = makeProvider({ OUTLOOK_CLIENT_SECRET: 'y' });
    try {
      provider.assertConfigured();
      fail('expected AppException');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).getStatus()).toBe(503);
      expect((err as AppException).technicalDetail).toContain('OUTLOOK_CLIENT_ID');
    }
  });
});

describe('OutlookProvider · getAuthUrl', () => {
  it('builds the Microsoft authorize URL with Mail.Read scope + forwarded state', () => {
    const url = makeProvider().getAuthUrl('signed-state');
    expect(url).toContain('login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(url).toContain('client_id=oc-id');
    expect(url).toContain('state=signed-state');
    expect(decodeURIComponent(url)).toContain('Mail.Read');
    expect(decodeURIComponent(url)).toContain('offline_access');
  });
});

describe('OutlookProvider · exchangeCode', () => {
  it('exchanges the code and reads the connected account email', async () => {
    global.fetch = routeFetch([
      ['/oauth2/v2.0/token', (_u, init) => {
        expect(init.body).toContain('grant_type=authorization_code');
        return jsonRes({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
      }],
      ['graph.microsoft.com/v1.0/me', () => jsonRes({ mail: 'user@contoso.com' })],
    ]) as any;

    const { email, tokens } = await makeProvider().exchangeCode('the-code');
    expect(email).toBe('user@contoso.com');
    expect(tokens.access_token).toBe('at');
    expect(tokens.refresh_token).toBe('rt');
    expect(tokens.expiry).toBeGreaterThan(Date.now());
  });

  it('falls back to userPrincipalName when mail is null', async () => {
    global.fetch = routeFetch([
      ['/oauth2/v2.0/token', () => jsonRes({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })],
      ['/v1.0/me', () => jsonRes({ mail: null, userPrincipalName: 'upn@contoso.com' })],
    ]) as any;
    const { email } = await makeProvider().exchangeCode('c');
    expect(email).toBe('upn@contoso.com');
  });
});

describe('OutlookProvider · session (fresh token)', () => {
  const fresh = { access_token: 'at', refresh_token: 'rt', expiry: Date.now() + 3_600_000 };

  it('listRecentIds maps message ids', async () => {
    global.fetch = routeFetch([
      ['/me/messages?', () => jsonRes({ value: [{ id: 'm1' }, { id: 'm2' }] })],
    ]) as any;
    const ids = await makeProvider().openSession(fresh).listRecentIds(Math.floor(Date.now() / 1000));
    expect(ids).toEqual(['m1', 'm2']);
  });

  it('getMessage normalizes headers, text body and invoice attachments', async () => {
    global.fetch = routeFetch([
      ['/attachments', () => jsonRes({ value: [
        { id: 'a1', contentType: 'application/pdf' },
        { id: 'a2', contentType: 'text/calendar' }, // filtered out
      ] })],
      ['/me/messages/m1', (_u, init) => {
        expect(init.headers.Prefer).toContain('text');
        return jsonRes({
          subject: 'Boleta',
          from: { emailAddress: { name: 'Jose', address: 'jose@acme.com' } },
          body: { content: 'cuerpo plano' },
          hasAttachments: true,
        });
      }],
    ]) as any;

    const msg = await makeProvider().openSession(fresh).getMessage('m1');
    expect(msg).toEqual({
      id: 'm1',
      subject: 'Boleta',
      from: 'Jose <jose@acme.com>',
      body: 'cuerpo plano',
      attachments: [{ id: 'a1', mimeType: 'application/pdf' }],
    });
  });

  it('getAttachmentBase64 returns Graph contentBytes verbatim', async () => {
    global.fetch = routeFetch([
      ['/attachments/a1', () => jsonRes({ contentBytes: 'QkFTRTY0' })],
    ]) as any;
    const b64 = await makeProvider().openSession(fresh).getAttachmentBase64('m1', 'a1');
    expect(b64).toBe('QkFTRTY0');
  });

  it('getMessage URL-encodes ids with special chars (/, =) in the path', async () => {
    let getUrl = '';
    global.fetch = routeFetch([
      ['/me/messages/', (url) => {
        getUrl = url;
        return jsonRes({
          subject: 'S',
          from: { emailAddress: { address: 'a@b.com' } },
          body: { content: 'x' },
          hasAttachments: false,
        });
      }],
    ]) as any;

    await makeProvider().openSession(fresh).getMessage('AAMk/Ad=');
    expect(getUrl).toContain('AAMk%2FAd%3D');
    expect(getUrl).not.toContain('AAMk/Ad=');
  });
});

describe('OutlookProvider · session (token refresh)', () => {
  it('expired access token → refreshes before the Graph call and exposes new tokens', async () => {
    const refreshBody: string[] = [];
    global.fetch = routeFetch([
      ['/oauth2/v2.0/token', (_u, init) => {
        refreshBody.push(init.body);
        return jsonRes({ access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600 });
      }],
      ['/me/messages?', () => jsonRes({ value: [{ id: 'm9' }] })],
    ]) as any;

    const expired = { access_token: 'old', refresh_token: 'rt', expiry: Date.now() - 1000 };
    const session = makeProvider().openSession(expired);
    const ids = await session.listRecentIds(1);

    expect(ids).toEqual(['m9']);
    expect(refreshBody[0]).toContain('grant_type=refresh_token');
    expect(session.currentTokens().access_token).toBe('new-at');
    expect(session.currentTokens().refresh_token).toBe('new-rt');
  });

  it('401 on a Graph call → one refresh + retry', async () => {
    let msgCalls = 0;
    global.fetch = routeFetch([
      ['/oauth2/v2.0/token', () => jsonRes({ access_token: 'refreshed', refresh_token: 'rt2', expires_in: 3600 })],
      ['/me/messages?', () => {
        msgCalls++;
        return msgCalls === 1 ? jsonRes({}, 401) : jsonRes({ value: [{ id: 'm1' }] });
      }],
    ]) as any;

    const fresh = { access_token: 'at', refresh_token: 'rt', expiry: Date.now() + 3_600_000 };
    const ids = await makeProvider().openSession(fresh).listRecentIds(1);
    expect(ids).toEqual(['m1']);
    expect(msgCalls).toBe(2);
  });

  it('second refresh omits refresh_token → keeps the one from the FIRST refresh (last-known)', async () => {
    let tokenCalls = 0;
    global.fetch = routeFetch([
      ['/oauth2/v2.0/token', () => {
        tokenCalls++;
        // 1er refresh rota el token; el 2do NO devuelve refresh_token.
        return tokenCalls === 1
          ? jsonRes({ access_token: 'at1', refresh_token: 'rt-first', expires_in: 3600 })
          : jsonRes({ access_token: 'at2', expires_in: 3600 });
      }],
      ['/me/messages?', () => jsonRes({ value: [{ id: 'm1' }] })],
    ]) as any;

    // Empieza expirado → fuerza el 1er refresh; luego lo volvemos a expirar a mano.
    const expired = { access_token: 'old', refresh_token: 'rt-orig', expiry: Date.now() - 1000 };
    const session = makeProvider().openSession(expired);

    await session.listRecentIds(1); // 1er refresh → refresh_token = 'rt-first'
    expect(session.currentTokens().refresh_token).toBe('rt-first');

    // Forzamos que el próximo call vuelva a refrescar y el response omite refresh_token.
    (session.currentTokens() as any).expiry = Date.now() - 1000;
    await session.listRecentIds(1); // 2do refresh sin refresh_token → conserva 'rt-first'

    expect(tokenCalls).toBe(2);
    expect(session.currentTokens().refresh_token).toBe('rt-first');
  });
});
