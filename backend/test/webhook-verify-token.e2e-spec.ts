import 'reflect-metadata';
import { constantTimeEqual } from '../src/common/utils/constant-time';
import { WebhooksController } from '../src/modules/webhooks/webhooks.controller';
import { WhatsAppWebhookController } from '../src/modules/whatsapp/whatsapp.webhook.controller';

/**
 * Audit H10 — verify-token de webhooks en tiempo constante + fail-closed.
 * - constantTimeEqual: primitivo de comparación.
 * - Los dos endpoints GET de verificación (Meta challenge) rechazan si falta
 *   el secreto (antes: fallback a 'change_me' / comparación contra undefined).
 */
describe('H10 — verify-token constant-time + fail-closed', () => {
  describe('constantTimeEqual', () => {
    it('strings idénticos → true', () => {
      expect(constantTimeEqual('secret-token', 'secret-token')).toBe(true);
    });
    it('strings distintos (mismo largo) → false', () => {
      expect(constantTimeEqual('secret-token', 'secret-tokeX')).toBe(false);
    });
    it('largos distintos → false', () => {
      expect(constantTimeEqual('abc', 'abcdef')).toBe(false);
    });
    it('vacío / undefined / null → false', () => {
      expect(constantTimeEqual('', 'x')).toBe(false);
      expect(constantTimeEqual('x', '')).toBe(false);
      expect(constantTimeEqual(undefined, 'x')).toBe(false);
      expect(constantTimeEqual('x', null)).toBe(false);
      expect(constantTimeEqual('', '')).toBe(false);
    });
  });

  describe('WebhooksController.verify (genérico)', () => {
    const ctrl = new WebhooksController({} as any);
    const ORIGINAL = process.env.WEBHOOK_SECRET;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.WEBHOOK_SECRET;
      else process.env.WEBHOOK_SECRET = ORIGINAL;
    });

    function mockReply() {
      const r: any = {};
      r.status = jest.fn(() => r);
      r.send = jest.fn(() => r);
      return r;
    }

    it('sin WEBHOOK_SECRET → 403 (fail-closed, sin fallback a change_me)', () => {
      delete process.env.WEBHOOK_SECRET;
      const reply = mockReply();
      ctrl.verify('canal-1', 'subscribe', 'change_me', '123', reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it('token correcto → 200 + challenge', () => {
      process.env.WEBHOOK_SECRET = 'real-secret';
      const reply = mockReply();
      ctrl.verify('canal-1', 'subscribe', 'real-secret', '999', reply);
      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith('999');
    });

    it('token incorrecto → 403', () => {
      process.env.WEBHOOK_SECRET = 'real-secret';
      const reply = mockReply();
      ctrl.verify('canal-1', 'subscribe', 'guess', '999', reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });

  describe('WhatsAppWebhookController.verify (Meta challenge)', () => {
    // Solo verify() — usa this.logger + env + constantTimeEqual; el resto de
    // las deps no se tocan en este método. Responde vía @Res reply (Fastify).
    const ctrl = new (WhatsAppWebhookController as any)(
      null, null, null, null, null, null, null, null,
    ) as WhatsAppWebhookController;
    const ORIGINAL = process.env.WHATSAPP_VERIFY_TOKEN;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
      else process.env.WHATSAPP_VERIFY_TOKEN = ORIGINAL;
    });

    function mockReply() {
      const r: any = {};
      r.status = jest.fn(() => r);
      r.send = jest.fn(() => r);
      return r;
    }

    it('sin WHATSAPP_VERIFY_TOKEN → 403 Forbidden (fail-closed)', () => {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
      const reply = mockReply();
      ctrl.verify('subscribe', 'whatever', '42', reply);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith('Forbidden');
    });

    it('token correcto → 200 + challenge', () => {
      process.env.WHATSAPP_VERIFY_TOKEN = 'wa-token';
      const reply = mockReply();
      ctrl.verify('subscribe', 'wa-token', '42', reply);
      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith('42');
    });

    it('token incorrecto → 403 Forbidden', () => {
      process.env.WHATSAPP_VERIFY_TOKEN = 'wa-token';
      const reply = mockReply();
      ctrl.verify('subscribe', 'wrong', '42', reply);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith('Forbidden');
    });
  });
});
