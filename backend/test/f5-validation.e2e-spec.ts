import 'reflect-metadata';
import * as request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';

import { AuthGuard } from '../src/common/guards/auth.guard';
import { ClientIsolationGuard } from '../src/common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../src/common/guards/client-active.guard';
import { ResendEmailService } from '../src/common/email/resend.service';
import { F5Controller } from '../src/modules/f5/f5.controller';

import { configServiceProvider, tokenFor } from './helpers';

/**
 * Audit H5 (DTOs validados, no aceptar persona_id del body) + H6 (cerrar
 * activación idempotente). HTTP real con ValidationPipe (whitelist +
 * forbidNonWhitelisted), servicios mockeados, sin DB.
 */
const CLIENT = '22222222-2222-2222-2222-222222222222';
const ACT = '11111111-1111-1111-1111-111111111111';
const passGuard = { canActivate: () => true };

describe('H5/H6 — F5 controller', () => {
  let app: INestApplication;
  const ds = { query: jest.fn() };
  const email = { sendReporteCliente: jest.fn(async () => true) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [F5Controller],
      providers: [
        { provide: DataSource, useValue: ds },
        { provide: getDataSourceToken(), useValue: ds },
        { provide: ResendEmailService, useValue: email },
        { provide: getQueueToken('report-gen'), useValue: { add: jest.fn() } },
        AuthGuard,
        Reflector,
        configServiceProvider,
      ],
    })
      .overrideGuard(ClientIsolationGuard)
      .useValue(passGuard)
      .overrideGuard(ClientActiveGuard)
      .useValue(passGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    ds.query.mockReset();
    email.sendReporteCliente.mockClear();
  });

  const auth = () => `Bearer ${tokenFor(CLIENT, 'user')}`;

  // ── H5 — checkins: persona_id NO se acepta del body ────────────────────────
  describe('H5 — createCheckin', () => {
    const url = `/v1/app/f5/activaciones/${ACT}/checkins`;

    it('persona_id en el body → 400 (forbidNonWhitelisted, no se puede impersonar)', async () => {
      await request(app.getHttpServer())
        .post(url)
        .set('Authorization', auth())
        .send({ persona_id: 'otra-persona', observacion: 'hola' })
        .expect(400);
      expect(ds.query).not.toHaveBeenCalled();
    });

    it('body válido → inserta con persona_id = user.sub (UUID del token)', async () => {
      ds.query.mockResolvedValueOnce([{ id: 'c1' }]);
      await request(app.getHttpServer())
        .post(url)
        .set('Authorization', auth())
        .send({ observacion: 'todo ok' })
        .expect(201);

      const params = ds.query.mock.calls[0][1];
      // params = [client_id, activacion_id, persona_id, observacion]
      expect(params[0]).toBe(CLIENT);
      expect(params[2]).toMatch(/^[0-9a-f-]{36}$/i); // el sub del token, no del body
      expect(params[3]).toBe('todo ok');
    });
  });

  // ── H5 — enviarReporte: emails validados ───────────────────────────────────
  describe('H5 — enviarReporte', () => {
    const url = `/v1/app/f5/activaciones/${ACT}/reporte-cliente/enviar`;

    it('destinatario con email inválido → 400', () =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', auth())
        .send({ destinatarios: ['no-es-un-email'], htmlReporte: '<p>x</p>' })
        .expect(400));

    it('destinatarios vacío → 400', () =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', auth())
        .send({ destinatarios: [], htmlReporte: '<p>x</p>' })
        .expect(400));

    it('emails válidos → manda el reporte', async () => {
      ds.query.mockResolvedValue([]); // acts vacío + insert
      await request(app.getHttpServer())
        .post(url)
        .set('Authorization', auth())
        .send({ destinatarios: ['cliente@empresa.com'], htmlReporte: '<p>reporte</p>' })
        .expect(201);
      expect(email.sendReporteCliente).toHaveBeenCalled();
    });
  });

  // ── H6 — cerrarActivacion idempotente ──────────────────────────────────────
  describe('H6 — cerrarActivacion', () => {
    const url = `/v1/app/f5/activaciones/${ACT}/cerrar`;

    it('ya cerrada / no existe (UPDATE no matchea fila) → 409', async () => {
      ds.query.mockResolvedValueOnce([]); // ninguna fila actualizada
      await request(app.getHttpServer())
        .patch(url)
        .set('Authorization', auth())
        .send({ cierre: { nota: 'fin' } })
        .expect(409);
    });

    it('activación abierta → cierra y devuelve la fila', async () => {
      ds.query.mockResolvedValueOnce([{ id: ACT, estado_f5: 'cerrada' }]);
      const res = await request(app.getHttpServer())
        .patch(url)
        .set('Authorization', auth())
        .send({ cierre: { nota: 'fin' } })
        .expect(200);
      expect(res.body.id).toBe(ACT);
    });
  });
});
