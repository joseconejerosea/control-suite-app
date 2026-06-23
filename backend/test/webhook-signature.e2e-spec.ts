import 'reflect-metadata';
import { createHmac } from 'crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { WebhookSignatureGuard } from '../src/common/guards/webhook-signature.guard';

/**
 * Audit C2 (+ M11) — WebhookSignatureGuard. Verifica la firma de Meta y el
 * comportamiento FAIL-CLOSED cuando falta el secreto (antes: HMAC con clave
 * vacía → firma forjable).
 */
function ctxFor(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guardWith(secrets: Record<string, string | undefined>): WebhookSignatureGuard {
  const config = { get: (k: string) => secrets[k] } as unknown as ConfigService;
  const ds = { getRepository: () => ({ findOne: async () => null }) } as unknown as DataSource;
  return new WebhookSignatureGuard(config, ds);
}

const META_HEADER = 'x-hub-signature-256';

describe('C2 — WebhookSignatureGuard', () => {
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: '1' }] }));

  it('sin rawBody → 401', async () => {
    const guard = guardWith({ META_APP_SECRET: 'secret' });
    await expect(guard.canActivate(ctxFor({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Meta webhook con firma válida → true', async () => {
    const secret = 'topsecret-meta';
    const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
    const guard = guardWith({ META_APP_SECRET: secret });
    const req = { rawBody, headers: { [META_HEADER]: `sha256=${sig}` }, params: {} };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });

  it('Meta webhook con firma inválida → 401', async () => {
    const guard = guardWith({ META_APP_SECRET: 'topsecret-meta' });
    const req = { rawBody, headers: { [META_HEADER]: 'sha256=deadbeef' }, params: {} };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Meta webhook con META_APP_SECRET vacío → 401 fail-closed (M11)', async () => {
    // Aunque el atacante "firme" con clave vacía, el guard rechaza por no estar configurado.
    const sig = createHmac('sha256', '').update(rawBody).digest('hex');
    const guard = guardWith({ META_APP_SECRET: '' });
    const req = { rawBody, headers: { [META_HEADER]: `sha256=${sig}` }, params: {} };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('webhook genérico sin secreto configurado → 401 fail-closed (M11)', async () => {
    const guard = guardWith({ WEBHOOK_SECRET: '' });
    const req = { rawBody, headers: { 'x-webhook-signature': 'sha256=abc' }, params: {} };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
