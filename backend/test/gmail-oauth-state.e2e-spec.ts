import 'reflect-metadata';
import { randomUUID, createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

// El constructor de GmailService programa un cron real (cada 10s). Lo neutralizamos.
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

import { GmailService } from '../src/modules/gmail/gmail.service';
import { InvoicesService } from '../src/modules/invoices/invoices.service';

/**
 * Audit C3 — `state` firmado del OAuth de Gmail (anti-CSRF). El client_id viaja
 * dentro de un state HMAC con expiración; el callback NO confía en input crudo.
 */
const SECRET = 'test-jwt-secret-with-at-least-32-characters-xx';

function craftState(secret: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

describe('C3 — Gmail OAuth signed state', () => {
  let svc: any;

  beforeAll(() => {
    const config = { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) } as unknown as ConfigService;
    const ds = {} as unknown as DataSource;
    const invoices = {} as unknown as InvoicesService;
    // 4º dep (OperatorNotifierService): este test solo ejercita el firmado de state
    // (usa config.JWT_SECRET), así que un stub vacío alcanza.
    const notifier = {} as any;
    svc = new GmailService(config, ds, invoices, notifier);
  });

  it('roundtrip: verifyState(buildState(clientId)) === clientId', () => {
    const clientId = randomUUID();
    const state = svc.buildState(clientId);
    expect(svc.verifyState(state)).toBe(clientId);
  });

  it('firma adulterada → rechaza', () => {
    const clientId = randomUUID();
    const state = svc.buildState(clientId);
    const tampered = state.slice(0, -2) + (state.endsWith('aa') ? 'bb' : 'aa');
    expect(() => svc.verifyState(tampered)).toThrow();
  });

  it('state firmado con OTRO secreto → rechaza', () => {
    const forged = craftState('otro-secreto-cualquiera', { c: randomUUID(), n: 'aa', e: Date.now() + 60000 });
    expect(() => svc.verifyState(forged)).toThrow();
  });

  it('state expirado → rechaza', () => {
    const expired = craftState(SECRET, { c: randomUUID(), n: 'aa', e: Date.now() - 1000 });
    expect(() => svc.verifyState(expired)).toThrow();
  });

  it('state vacío o malformado → rechaza', () => {
    expect(() => svc.verifyState('')).toThrow();
    expect(() => svc.verifyState('garbage')).toThrow();
  });

  it('handleCallback con state inválido rechaza ANTES de tocar Google', async () => {
    await expect(svc.handleCallback('any-code', 'bad.state')).rejects.toThrow();
  });
});
