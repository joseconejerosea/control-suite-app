import 'reflect-metadata';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { Reflector, APP_GUARD } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AuthGuard } from '../src/common/guards/auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';

import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { OnboardingController } from '../src/modules/onboarding/onboarding.controller';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';
import { MetricsController } from '../src/modules/metrics/metrics.controller';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import { GmailController } from '../src/modules/gmail/gmail.controller';
import { GmailService } from '../src/modules/gmail/gmail.service';

import { configServiceProvider, tokenFor } from './helpers';

/**
 * Audit CRÍTICOS de control de acceso — C4 (register), C5 (onboarding RolesGuard),
 * C6 (/metrics), C3 (endpoints Gmail). Verifica el ENFORCEMENT de los guards a
 * nivel HTTP, sin DB: los servicios están mockeados; lo que se prueba es que el
 * request llega (o NO llega) al handler según rol/token.
 *
 * Nota: AuthGuard se registra como APP_GUARD para replicar que en prod es global
 * (gmail connect/status dependen de él, no tienen @UseGuards propio).
 */
const CLIENT = randomUUID();

const noop = async () => ({});
const onboardingMock = {
  createAdminUser: noop, completeOnboarding: noop,
};
const authMock = {
  register: async () => ({ accessToken: 'a', refreshToken: 'b' }),
  login: async () => ({ accessToken: 'a', refreshToken: 'b' }),
  refreshToken: async () => ({ accessToken: 'a', refreshToken: 'b' }),
};
const gmailMock = {
  getAuthUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth?state=x',
  handleCallback: async () => 'cuenta@tenant.test',
  pollAllClients: async () => undefined,
  statusForTenant: async () => ({ connected: false, accounts: [] }),
};

describe('Access-control criticals (C3/C4/C5/C6)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, OnboardingController, MetricsController, GmailController],
      providers: [
        { provide: AuthService, useValue: authMock },
        { provide: OnboardingService, useValue: onboardingMock },
        MetricsService, // liviano, sin deps
        { provide: GmailService, useValue: gmailMock },
        AuthGuard,
        RolesGuard,
        Reflector,
        configServiceProvider,
        { provide: APP_GUARD, useClass: AuthGuard }, // replica el AuthGuard global de prod
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── C4 — POST /auth/register reservado a super_admin ───────────────────────
  describe('C4 — register', () => {
    it('sin token → 401', () =>
      request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'x@y.com', password: 'password123', client_id: CLIENT })
        .expect(401));

    it('usuario normal → 403', () =>
      request(app.getHttpServer())
        .post('/auth/register')
        .set('Authorization', `Bearer ${tokenFor(CLIENT, 'user')}`)
        .send({ email: 'x@y.com', password: 'password123', client_id: CLIENT })
        .expect(403));

    it('super_admin → pasa los guards (201)', () =>
      request(app.getHttpServer())
        .post('/auth/register')
        .set('Authorization', `Bearer ${tokenFor(CLIENT, 'super_admin')}`)
        .send({ email: 'x@y.com', password: 'password123', client_id: CLIENT })
        .expect(201));
  });

  // ── C5 — onboarding ahora con RolesGuard efectivo ──────────────────────────
  describe('C5 — onboarding RolesGuard', () => {
    const url = `/onboarding/${CLIENT}/complete`;

    it('sin token → 401', () =>
      request(app.getHttpServer()).post(url).send({}).expect(401));

    it('usuario normal → 403 (antes era no-op y pasaba)', () =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${tokenFor(CLIENT, 'user')}`)
        .send({})
        .expect(403));

    it('super_admin → pasa los guards (201)', () =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${tokenFor(CLIENT, 'super_admin')}`)
        .send({})
        .expect(201));
  });

  // ── C6 — /metrics reservado a super_admin ──────────────────────────────────
  describe('C6 — metrics', () => {
    it('sin token → 401', () =>
      request(app.getHttpServer()).get('/metrics').expect(401));

    it('usuario normal → 403', () =>
      request(app.getHttpServer())
        .get('/metrics')
        .set('Authorization', `Bearer ${tokenFor(CLIENT, 'user')}`)
        .expect(403));

    it('super_admin → 200', () =>
      request(app.getHttpServer())
        .get('/metrics')
        .set('Authorization', `Bearer ${tokenFor(CLIENT, 'super_admin')}`)
        .expect(200));
  });

  // ── C3 — endpoints Gmail ───────────────────────────────────────────────────
  describe('C3 — gmail endpoints', () => {
    it('GET /auth/gmail/connect sin token → 401', () =>
      request(app.getHttpServer()).get('/auth/gmail/connect').expect(401));

    it('GET /auth/gmail/connect autenticado → 200 con { url }', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/gmail/connect')
        .set('Authorization', `Bearer ${tokenFor(CLIENT, 'user')}`)
        .expect(200);
      expect(res.body.url).toContain('accounts.google.com');
    });

    it('POST /auth/gmail/poll usuario normal → 403 (H12)', () =>
      request(app.getHttpServer())
        .post('/auth/gmail/poll')
        .set('Authorization', `Bearer ${tokenFor(CLIENT, 'user')}`)
        .expect(403));

    it('GET /auth/gmail/status sin token → 401 (H12)', () =>
      request(app.getHttpServer()).get('/auth/gmail/status').expect(401));

    it('GET /auth/gmail/callback es @Public (no 401)', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/gmail/callback?code=x&state=y');
      expect(res.status).not.toBe(401);
    });
  });
});
