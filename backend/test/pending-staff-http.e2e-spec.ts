import 'reflect-metadata';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { Reflector } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuthGuard } from '../src/common/guards/auth.guard';
import { ClientIsolationGuard } from '../src/common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../src/common/guards/client-active.guard';
import { PendingStaffController } from '../src/modules/pending-staff/pending-staff.controller';
import { PendingStaffService } from '../src/modules/pending-staff/pending-staff.service';
import {
  DB,
  ENTITIES_GLOB,
  configServiceProvider,
  JWT_SECRET,
} from './helpers';

/**
 * Slice B gap-closing — the pending_staff CONTROLLER through the full HTTP stack:
 * guard enforcement, JWT client_id → service wiring, DTO estado validation,
 * cross-tenant 404 on transitions, and the { phone } pre-fill contract.
 *
 * NOTE: this suite connects as the postgres superuser (BYPASSRLS) and installs
 * no TenantInterceptor, so the cross-tenant 404s here are proven by the service's
 * explicit `WHERE client_id = $` predicate, NOT by RLS. RLS itself is covered
 * separately by pending-staff-rls.e2e-spec.ts (dedicated NOBYPASSRLS role).
 */

jest.setTimeout(60000);

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();
const ROW_A = randomUUID();
const ROW_B = randomUUID();

function token(clientId: string, sub: string): string {
  return jwt.sign(
    { sub, email: `${sub}@t.local`, client_id: clientId, role: 'user' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

describe('Slice B — pending_staff controller over HTTP (guards + wiring + DTO)', () => {
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
      ],
      controllers: [PendingStaffController],
      providers: [
        PendingStaffService,
        AuthGuard,
        ClientIsolationGuard,
        ClientActiveGuard,
        Reflector,
        configServiceProvider,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    ds = moduleRef.get(DataSource);

    await ds.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO pending_staff (id, client_id, phone, motivo, estado) VALUES
        ($1,$3,'56911112222','evidence_unknown','pendiente'),
        ($2,$4,'56933334444','evidence_unknown','pendiente')`,
      [ROW_A, ROW_B, CLIENT_A, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM pending_staff WHERE client_id = ANY($1)`, [
        [CLIENT_A, CLIENT_B],
      ]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [
        [CLIENT_A, CLIENT_B],
      ]);
    }
    await app?.close();
  });

  it('GET /pending-staff without a token → 401', async () => {
    await request(app.getHttpServer()).get('/pending-staff').expect(401);
  });

  it('GET /pending-staff returns only the caller tenant rows', async () => {
    const res = await request(app.getHttpServer())
      .get('/pending-staff')
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A)}`)
      .expect(200);
    expect(res.body.map((r: any) => r.phone)).toEqual(['56911112222']);
  });

  it('GET /pending-staff?estado=invalid → 400 (DTO validation)', async () => {
    await request(app.getHttpServer())
      .get('/pending-staff?estado=invalid')
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A)}`)
      .expect(400);
  });

  it('PATCH /:id/agregar on another tenant row → 404', async () => {
    await request(app.getHttpServer())
      .patch(`/pending-staff/${ROW_B}/agregar`)
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A)}`)
      .expect(404);
  });

  it('PATCH /:id/agregar on own row → 200 and returns { phone } for pre-fill', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/pending-staff/${ROW_A}/agregar`)
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A)}`)
      .expect(200);
    expect(res.body.phone).toBe('56911112222');
  });

  it('PATCH /:id/descartar on own row → 200 and row persists as descartado', async () => {
    await request(app.getHttpServer())
      .patch(`/pending-staff/${ROW_B}/descartar`)
      .set('Authorization', `Bearer ${token(CLIENT_B, USER_B)}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/pending-staff?estado=descartado')
      .set('Authorization', `Bearer ${token(CLIENT_B, USER_B)}`)
      .expect(200);
    expect(res.body.map((r: any) => r.id)).toContain(ROW_B);
  });
});
