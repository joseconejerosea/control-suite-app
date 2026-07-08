import 'reflect-metadata';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { Reflector } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuthGuard } from '../src/common/guards/auth.guard';
import { ClientIsolationGuard } from '../src/common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../src/common/guards/client-active.guard';
import { PromotersController } from '../src/modules/promoters/promoters.controller';
import { PromotersService } from '../src/modules/promoters/promoters.service';
import { Promoter } from '../src/modules/promoters/entities/promoter.entity';
import { DB, ENTITIES_GLOB, configServiceProvider, tokenFor } from './helpers';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();

/**
 * Regresión del drift del WRITE path de `promoters` (STAFF).
 *
 * Bug original: `POST /api/promoters` daba 500 (`GET` andaba). La tabla arrastra
 * una columna legacy `name` NOT NULL sin default (CreatePromoters #004); el modelo
 * la partió en first_name/last_name y ningún INSERT la llena. Fix: migración #057
 * (`ALTER COLUMN name DROP NOT NULL`).
 *
 * El guardián de este test es directo: `CreatePromoterDto` NO tiene campo `name`.
 * Si la columna legacy vuelve a ser NOT NULL, el primer test cae con 500.
 *
 * RED→GREEN (regla del proyecto): para verlo ROJO, en la DB de test correr
 *   ALTER TABLE promoters ALTER COLUMN name SET NOT NULL;
 * el `POST … (201 + persisted)` debe romper con 500. Restaurar con la #057
 * (`… DROP NOT NULL`) y vuelve a GREEN.
 */
describe('Promoters — create (STAFF) [regression: legacy `name` NOT NULL]', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          ...DB,
          ssl: false,
          synchronize: false,
          entities: [ENTITIES_GLOB],
        }),
        TypeOrmModule.forFeature([Promoter]),
      ],
      controllers: [PromotersController],
      providers: [
        PromotersService,
        AuthGuard,
        ClientIsolationGuard,
        ClientActiveGuard,
        Reflector,
        configServiceProvider,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    ds = moduleRef.get(DataSource);

    await ds.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM promoters WHERE client_id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
    }
    await app?.close();
  });

  // ── El corazón de la regresión ──────────────────────────────────────────────
  // El DTO no manda `name`. Un 201 (y no un 500) prueba que la columna legacy
  // `name` dejó de bloquear el INSERT.
  it('POST /promoters crea un promotor SIN campo `name` (201 + persistido)', async () => {
    const res = await request(app.getHttpServer())
      .post('/promoters')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .send({
        first_name: 'Thomas',
        last_name: 'Test',
        email: `staff-${randomUUID()}@a.test`,
        phone: '+56 9 8765 4321',
        status: 'active',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.client_id).toBe(CLIENT_A);
    expect(res.body.first_name).toBe('Thomas');
    expect(res.body.last_name).toBe('Test');
    expect(res.body.status).toBe('active');
  });

  it('el promotor creado se lee por GET /promoters, scopeado al tenant que llama', async () => {
    const email = `readback-${randomUUID()}@a.test`;
    await request(app.getHttpServer())
      .post('/promoters')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .send({ first_name: 'Read', last_name: 'Back', email, status: 'active' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/promoters')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(200);

    expect(res.body.some((p: any) => p.email === email)).toBe(true);
    expect(res.body.every((p: any) => p.client_id === CLIENT_A)).toBe(true);
  });

  it('estampa el tenant del JWT — el tenant B nunca ve promotores del tenant A', async () => {
    await request(app.getHttpServer())
      .post('/promoters')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .send({ first_name: 'Only', last_name: 'A', email: `onlya-${randomUUID()}@a.test`, status: 'active' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/promoters')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_B)}`)
      .expect(200);

    expect(res.body.some((p: any) => p.client_id === CLIENT_A)).toBe(false);
  });

  it('rechaza email duplicado dentro del mismo tenant (409)', async () => {
    const email = `dup-${randomUUID()}@a.test`;

    await request(app.getHttpServer())
      .post('/promoters')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .send({ first_name: 'Dup', last_name: 'One', email, status: 'active' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/promoters')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .send({ first_name: 'Dup', last_name: 'Two', email, status: 'active' })
      .expect(409);
  });
});
