/// <reference types="jest" />
import { WhatsAppService } from './whatsapp.service';

const API = 'https://graph.facebook.com/v19.0';

/** A minimal fetch Response stub honoring the fields the service reads. */
function fetchResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('WhatsAppService — outbound to the single global number', () => {
  const GLOBAL_PN = '100000000000000';
  const TO = '5215512345678';

  let service: WhatsAppService;
  let fetchMock: jest.Mock;

  // R3-011 — remember the env we mutate so afterEach can restore it and not
  // leak into other spec files sharing the process.
  const savedPn = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const savedToken = process.env.WHATSAPP_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = GLOBAL_PN;
    process.env.WHATSAPP_ACCESS_TOKEN = 'perm-token';
    // The service reads the global id at construction time (field initializer).
    service = new WhatsAppService();

    fetchMock = jest.fn().mockResolvedValue(fetchResponse(true, { messages: [{ id: 'wamid.1' }] }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedPn === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = savedPn;
    if (savedToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = savedToken;
  });

  function urlOfCall(index = 0): string {
    return fetchMock.mock.calls[index][0] as string;
  }

  function initOfCall(index = 0): RequestInit {
    return fetchMock.mock.calls[index][1] as RequestInit;
  }

  describe('sendText', () => {
    it('sends from the single global WHATSAPP_PHONE_NUMBER_ID', async () => {
      await service.sendText(TO, 'hola');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(urlOfCall()).toBe(`${API}/${GLOBAL_PN}/messages`);
    });

    // R3-012 — assert the Authorization header and request body/`to`.
    it('sends the bearer Authorization header and the expected text body', async () => {
      await service.sendText(TO, 'hola mundo');
      const init = initOfCall();
      expect((init.headers as any)['Authorization']).toBe('Bearer perm-token');
      expect((init.headers as any)['Content-Type']).toBe('application/json');
      const body = JSON.parse(init.body as string);
      expect(body.messaging_product).toBe('whatsapp');
      expect(body.type).toBe('text');
      expect(body.text.body).toBe('hola mundo');
      expect(body.to).toBe('5215512345678');
    });

    // R1-002 — a non-numeric configured id must NOT hit fetch and returns false.
    it('refuses to fetch when the global id is non-numeric (R1-002)', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'evil.example.com/../path';
      const svc = new WhatsAppService();
      const ok = await svc.sendText(TO, 'hola');
      expect(ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to fetch when no id is configured (R1-002)', async () => {
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      const svc = new WhatsAppService(); // constructs with undefined global id
      const ok = await svc.sendText(TO, 'hola');
      expect(ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('sendTemplate', () => {
    it('sends from the single global WHATSAPP_PHONE_NUMBER_ID', async () => {
      await service.sendTemplate(TO, 'tpl', []);
      expect(urlOfCall()).toBe(`${API}/${GLOBAL_PN}/messages`);
    });

    // R3-012 — assert the Authorization header and template body/`to`.
    it('sends the bearer Authorization header and the expected template body', async () => {
      await service.sendTemplate(TO, 'welcome', ['a', 'b']);
      const init = initOfCall();
      expect((init.headers as any)['Authorization']).toBe('Bearer perm-token');
      const body = JSON.parse(init.body as string);
      expect(body.type).toBe('template');
      expect(body.template.name).toBe('welcome');
      expect(body.to).toBe('5215512345678');
    });

    // R1-002 — non-numeric configured id blocks fetch and returns false.
    it('refuses to fetch when the global id is non-numeric (R1-002)', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'not-a-number';
      const svc = new WhatsAppService();
      const ok = await svc.sendTemplate(TO, 'tpl', []);
      expect(ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
