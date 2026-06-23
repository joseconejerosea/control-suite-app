import 'reflect-metadata';
import { join } from 'path';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuthGuard } from '../src/common/guards/auth.guard';
import { ClientIsolationGuard } from '../src/common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../src/common/guards/client-active.guard';
import { EventosCrudosController } from '../src/modules/eventos-crudos/eventos-crudos.controller';
import { EventosCrudosService } from '../src/modules/eventos-crudos/eventos-crudos.service';
import { EventProducer } from '../src/modules/queue/producers/event.producer';

/**
 * Disposable test DB stood up for Phase 0.3 (see REMEDIATION-PLAN).
 * Override with DB_* env vars if needed.
 */
const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: parseInt(process.env.DB_PORT ?? '5433', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'controlsuite_test',
};

const JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters-xx';

// Two distinct tenants seeded for the isolation matrix.
const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const EVENT_A = randomUUID();
const EVENT_B = randomUUID();

function tokenFor(clientId: string, role = 'user'): string {
  // Mirrors the real token shape: snake_case client_id only.
  return jwt.sign(
    { sub: randomUUID(), email: `user@${clientId}.test`, client_id: clientId, role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

describe('Tenant isolation — eventos-crudos (CAT 1)', () => {
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
          // Load every entity so relations (CanalEntrada, User, ...) resolve.
          entities: [join(__dirname, '..', 'src', '**', '*.entity.ts')],
        }),
      ],
      controllers: [EventosCrudosController],
      providers: [
        EventosCrudosService,
        AuthGuard,
        ClientIsolationGuard,
        ClientActiveGuard,
        Reflector,
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'JWT_SECRET' ? JWT_SECRET : undefined) } },
        // Mock the queue producer so no Redis is required.
        { provide: EventProducer, useValue: { publishProcessEvent: async () => ({ id: 'job-test-1' }) } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    ds = moduleRef.get(DataSource);

    // Seed: two active tenants, one error-event each.
    await ds.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO eventos_crudos (id, client_id, payload, source, status)
       VALUES ($1,$2,'{}'::jsonb,'whatsapp','error'), ($3,$4,'{}'::jsonb,'whatsapp','error')`,
      [EVENT_A, CLIENT_A, EVENT_B, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM eventos_crudos WHERE id = ANY($1)`, [[EVENT_A, EVENT_B]]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
    }
    await app?.close();
  });

  it('GET /eventos-crudos returns ONLY the caller tenant rows', async () => {
    const res = await request(app.getHttpServer())
      .get('/eventos-crudos')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // Must not leak tenant B.
    expect(res.body.every((e: any) => e.client_id === CLIENT_A)).toBe(true);
    expect(res.body.some((e: any) => e.client_id === CLIENT_B)).toBe(false);
    expect(res.body).toHaveLength(1);
  });

  it("GET /eventos-crudos/:id of another tenant's event returns 404 (no cross-tenant read)", async () => {
    await request(app.getHttpServer())
      .get(`/eventos-crudos/${EVENT_B}`)
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(404);
  });

  it('POST /eventos-crudos/:id/retry on another tenant event returns 404 (no cross-tenant write)', async () => {
    await request(app.getHttpServer())
      .post(`/eventos-crudos/${EVENT_B}/retry`)
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(404);
  });
});
