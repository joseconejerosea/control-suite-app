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
import { NotificationsController } from '../src/modules/notifications/notifications.controller';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import {
  DB,
  ENTITIES_GLOB,
  configServiceProvider,
  JWT_SECRET,
} from './helpers';

/**
 * Slice A gap-closing — the notifications CONTROLLER through the full HTTP stack
 * (guards + JWT → params wiring + DTO validation + own-only end-to-end). The
 * RLS/own-only service test proves the SQL; this proves the controller actually
 * routes the authenticated user's identity (client_id + sub) into the service
 * and that the guard stack enforces auth. A swapped client_id/sub or a dropped
 * guard would be invisible to tsc and to the service specs — only this catches it.
 *
 * Uses the postgres role (BYPASSRLS); isolation here is enforced by the explicit
 * WHERE client_id/user_id + the guard-provided identity, which is exactly the
 * controller wiring under test.
 */

jest.setTimeout(60000);

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const USER_A1 = randomUUID();
const USER_A2 = randomUUID();
const USER_B1 = randomUUID();

const N_A1_1 = randomUUID();
const N_A1_2 = randomUUID();
const N_A2 = randomUUID();
const N_B1 = randomUUID();

/** Token with an explicit `sub` so own-only wiring can be asserted. */
function token(clientId: string, sub: string): string {
  return jwt.sign(
    { sub, email: `${sub}@t.local`, client_id: clientId, role: 'user' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

describe('Slice A — notifications controller over HTTP (guards + wiring + DTO)', () => {
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
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        AuthGuard,
        ClientIsolationGuard,
        ClientActiveGuard,
        Reflector,
        configServiceProvider,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts so DTO validation is exercised end-to-end.
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
      `INSERT INTO notifications (id, client_id, user_id, type, title) VALUES
        ($1,$5,$7,'t','a1-first'),
        ($2,$5,$7,'t','a1-second'),
        ($3,$5,$8,'t','a2-owned'),
        ($4,$6,$9,'t','b1-owned')`,
      [
        N_A1_1,
        N_A1_2,
        N_A2,
        N_B1,
        CLIENT_A,
        CLIENT_B,
        USER_A1,
        USER_A2,
        USER_B1,
      ],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM notifications WHERE client_id = ANY($1)`, [
        [CLIENT_A, CLIENT_B],
      ]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [
        [CLIENT_A, CLIENT_B],
      ]);
    }
    await app?.close();
  });

  it('GET /notifications without a token → 401 (AuthGuard enforced)', async () => {
    await request(app.getHttpServer()).get('/notifications').expect(401);
  });

  it('GET /notifications returns ONLY the caller’s own rows (JWT sub → user_id wiring)', async () => {
    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A1)}`)
      .expect(200);

    const titles = res.body.data.map((r: any) => r.title).sort();
    expect(titles).toEqual(['a1-first', 'a1-second']);
    expect(res.body.data.map((r: any) => r.user_id)).not.toContain(USER_A2);
    expect(res.body.unreadCount).toBe(2);
  });

  it('cross-tenant: tenant B caller sees none of tenant A rows', async () => {
    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${token(CLIENT_B, USER_B1)}`)
      .expect(200);
    expect(res.body.data.map((r: any) => r.title)).toEqual(['b1-owned']);
  });

  it('PATCH /:id/read on ANOTHER user’s notification → 404 (own-only through HTTP)', async () => {
    await request(app.getHttpServer())
      .patch(`/notifications/${N_A2}/read`)
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A1)}`)
      .expect(404);

    // A2's notification is still unread.
    const res = await request(app.getHttpServer())
      .get('/notifications?unread=true')
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A2)}`)
      .expect(200);
    expect(res.body.unreadCount).toBe(1);
  });

  it('PATCH /:id/read on OWN notification → 200 and clears it', async () => {
    await request(app.getHttpServer())
      .patch(`/notifications/${N_A2}/read`)
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A2)}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/notifications?unread=true')
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A2)}`)
      .expect(200);
    expect(res.body.unreadCount).toBe(0);
  });

  it('GET /notifications?unread=notabool → 400 (DTO validation)', async () => {
    await request(app.getHttpServer())
      .get('/notifications?unread=notabool')
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A1)}`)
      .expect(400);
  });

  it('POST /notifications/read-all → 200 and zeroes the caller’s unread count', async () => {
    await request(app.getHttpServer())
      .post('/notifications/read-all')
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A1)}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/notifications?unread=true')
      .set('Authorization', `Bearer ${token(CLIENT_A, USER_A1)}`)
      .expect(200);
    expect(res.body.unreadCount).toBe(0);
  });
});
