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
import { UserController } from '../src/modules/users/users.controller';
import { UserService } from '../src/modules/users/users.service';
import { User } from '../src/modules/users/user.entity';
import { DB, ENTITIES_GLOB, configServiceProvider, tokenFor } from './helpers';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();

describe('Tenant isolation — users (CAT 1)', () => {
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
        TypeOrmModule.forFeature([User]),
      ],
      controllers: [UserController],
      providers: [
        UserService,
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
    await ds.query(
      `INSERT INTO users (id, client_id, email, password, role)
       VALUES ($1,$2,'a@a.test','x','user'), ($3,$4,'b@b.test','x','user')`,
      [USER_A, CLIENT_A, USER_B, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM users WHERE client_id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
    }
    await app?.close();
  });

  it('GET /users returns ONLY the caller tenant users', async () => {
    const res = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(200);

    expect(res.body.every((u: any) => u.client_id === CLIENT_A)).toBe(true);
    expect(res.body.some((u: any) => u.client_id === CLIENT_B)).toBe(false);
    expect(res.body).toHaveLength(1);
  });

  it('POST /users always stamps the caller tenant (body cannot override client_id)', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .send({ email: 'new@a.test', password: 'secret123', client_id: CLIENT_B })
      .expect(201);

    expect(res.body.client_id).toBe(CLIENT_A);
  });
});
