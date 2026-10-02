/// <reference types="jest" />
/**
 * gmail.provider.spec.ts
 *
 * Gmail-specific assertions ported from the old gmail.service spec: OAuth scopes,
 * the config gate (AppException + technicalDetail naming the missing vars), code
 * exchange, message/attachment parsing (incl. extractBody), and token refresh
 * capture via the googleapis 'tokens' event.
 */
import { Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { GmailProvider } from './gmail.provider';
import { AppException } from '../../../common/exceptions/app.exception';

jest.mock('googleapis', () => {
  const holder: { tokensCb: ((t: any) => void) | null } = { tokensCb: null };
  const generateAuthUrl = jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock');
  const getToken = jest.fn().mockResolvedValue({ tokens: { access_token: 'a', refresh_token: 'r' } });
  const setCredentials = jest.fn();
  const on = jest.fn((ev: string, cb: (t: any) => void) => {
    if (ev === 'tokens') holder.tokensCb = cb;
  });
  const userinfoGet = jest.fn().mockResolvedValue({ data: { email: 'connected@acme.com' } });
  const messagesList = jest.fn();
  const messagesGet = jest.fn();
  const attachmentsGet = jest.fn();
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({ generateAuthUrl, getToken, setCredentials, on })),
      },
      oauth2: jest.fn().mockReturnValue({ userinfo: { get: userinfoGet } }),
      gmail: jest.fn().mockReturnValue({
        users: { messages: { list: messagesList, get: messagesGet, attachments: { get: attachmentsGet } } },
      }),
      __mocks: { holder, generateAuthUrl, getToken, setCredentials, on, userinfoGet, messagesList, messagesGet, attachmentsGet },
    },
  };
});

const gm = (google as any).__mocks;

const FULL_ENV: Record<string, string> = {
  GMAIL_CLIENT_ID: 'cid',
  GMAIL_CLIENT_SECRET: 'csecret',
  GMAIL_REDIRECT_URI: 'https://api.example.com/api/auth/gmail/callback',
};

function makeProvider(env: Record<string, string | undefined> = FULL_ENV) {
  const config = { get: jest.fn((k: string) => env[k]) } as any;
  return new GmailProvider(config);
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.clearAllMocks();
  gm.holder.tokensCb = null;
});

describe('GmailProvider · config gate', () => {
  it('isConfigured reflects presence of all env vars', () => {
    expect(makeProvider().isConfigured()).toBe(true);
    expect(makeProvider({ GMAIL_CLIENT_ID: 'x' }).isConfigured()).toBe(false);
  });

  it('assertConfigured with missing vars → AppException(config, 503) naming the vars', () => {
    const provider = makeProvider({ GMAIL_CLIENT_ID: undefined, GMAIL_CLIENT_SECRET: 'y', GMAIL_REDIRECT_URI: 'z' });
    try {
      provider.assertConfigured();
      fail('expected AppException');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).getStatus()).toBe(503);
      expect((err as AppException).technicalDetail).toContain('GMAIL_CLIENT_ID');
    }
  });
});

describe('GmailProvider · getAuthUrl', () => {
  it('returns the Google URL, forwards the state, and requests Gmail+Sheets scopes', () => {
    const provider = makeProvider();
    const url = provider.getAuthUrl('signed-state');
    expect(url).toBe('https://accounts.google.com/o/oauth2/auth?mock');
    const arg = gm.generateAuthUrl.mock.calls[0][0];
    expect(arg.access_type).toBe('offline');
    expect(arg.state).toBe('signed-state');
    expect(arg.scope).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/spreadsheets',
    ]);
  });

  it('not configured → throws before building a URL', () => {
    const provider = makeProvider({ GMAIL_CLIENT_ID: undefined });
    expect(() => provider.getAuthUrl('s')).toThrow(AppException);
    expect(gm.generateAuthUrl).not.toHaveBeenCalled();
  });
});

describe('GmailProvider · exchangeCode', () => {
  it('exchanges the code and returns the connected email + tokens', async () => {
    const provider = makeProvider();
    const res = await provider.exchangeCode('auth-code');
    expect(gm.getToken).toHaveBeenCalledWith('auth-code');
    expect(res.email).toBe('connected@acme.com');
    expect(res.tokens).toEqual({ access_token: 'a', refresh_token: 'r' });
  });

  it('Google returns no email → throws', async () => {
    gm.userinfoGet.mockResolvedValueOnce({ data: {} });
    const provider = makeProvider();
    await expect(provider.exchangeCode('c')).rejects.toThrow(/no devolvió el email/);
  });
});

describe('GmailProvider · session', () => {
  it('listRecentIds maps message ids (empty → [])', async () => {
    const provider = makeProvider();
    gm.messagesList.mockResolvedValueOnce({ data: { messages: [{ id: '1' }, { id: '2' }] } });
    const s = provider.openSession({ access_token: 'a' });
    expect(await s.listRecentIds(123)).toEqual(['1', '2']);

    gm.messagesList.mockResolvedValueOnce({ data: {} });
    expect(await provider.openSession({ access_token: 'a' }).listRecentIds(1)).toEqual([]);
  });

  it('getMessage normalizes headers, body and invoice attachments', async () => {
    const provider = makeProvider();
    gm.messagesGet.mockResolvedValueOnce({
      data: {
        payload: {
          headers: [
            { name: 'Subject', value: 'Boleta' },
            { name: 'From', value: 'Jose <jose@acme.com>' },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: Buffer.from('cuerpo del correo').toString('base64') } },
            { mimeType: 'image/jpeg', body: { attachmentId: 'att-1' } },
          ],
        },
      },
    });
    const msg = await provider.openSession({ access_token: 'a' }).getMessage('m1');
    expect(msg).toEqual({
      id: 'm1',
      subject: 'Boleta',
      from: 'Jose <jose@acme.com>',
      body: 'cuerpo del correo',
      attachments: [{ id: 'att-1', mimeType: 'image/jpeg' }],
    });
  });

  it('getMessage extractBody recurses into nested multipart to find text/plain', async () => {
    const provider = makeProvider();
    gm.messagesGet.mockResolvedValueOnce({
      data: {
        payload: {
          headers: [{ name: 'Subject', value: 'Anidado' }],
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('anidado').toString('base64') } }],
            },
          ],
        },
      },
    });
    const msg = await provider.openSession({ access_token: 'a' }).getMessage('m1');
    expect(msg.body).toBe('anidado');
  });

  it('getAttachmentBase64 converts URL-safe base64 to standard base64', async () => {
    const provider = makeProvider();
    gm.attachmentsGet.mockResolvedValueOnce({ data: { data: 'a-b_c-d_' } });
    const b64 = await provider.openSession({ access_token: 'a' }).getAttachmentBase64('m1', 'att-1');
    expect(b64).toBe('a+b/c+d/');
  });

  it('currentTokens reflects a refresh emitted via the googleapis tokens event', () => {
    const provider = makeProvider();
    const s = provider.openSession({ access_token: 'old' });
    expect(s.currentTokens()).toEqual({ access_token: 'old' });
    // simulate googleapis refreshing the access token mid-session
    gm.holder.tokensCb?.({ access_token: 'new' });
    expect(s.currentTokens()).toEqual({ access_token: 'new' });
  });
});
