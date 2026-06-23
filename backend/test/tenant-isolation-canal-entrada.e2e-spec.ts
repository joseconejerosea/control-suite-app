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
import { CanalEntradaController } from '../src/modules/canal-entrada/canal-entrada.controller';
import { CanalEntradaService } from '../src/modules/canal-entrada/canal-entrada.service';
import { DB, ENTITIES_GLOB, configServiceProvider, tokenFor } from './helpers';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const CANAL_A = randomUUID();
const CANAL_B = randomUUID();

describe('Tenant isolation — canal-entrada (CAT 1)', () => {
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
      controllers: [CanalEntradaController],
      providers: [
        CanalEntradaService,
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
      `INSERT INTO canal_entrada (id, client_id, nombre, tipo) VALUES ($1,$2,'Canal A','whatsapp'), ($3,$4,'Canal B','whatsapp')`,
      [CANAL_A, CLIENT_A, CANAL_B, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM canal_entrada WHERE id = ANY($1)`, [[CANAL_A, CANAL_B]]);
      // POST test may create extra rows for tenant A — clean those too.
      await ds.query(`DELETE FROM canal_entrada WHERE client_id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
    }
    await app?.close();
  });

  it('GET /canal-entrada returns ONLY the caller tenant rows', async () => {
    const res = await request(app.getHttpServer())
      .get('/canal-entrada')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(200);

    expect(res.body.every((c: any) => c.client_id === CLIENT_A)).toBe(true);
    expect(res.body.some((c: any) => c.client_id === CLIENT_B)).toBe(false);
  });

  it("GET /canal-entrada/:id of another tenant returns 404 (no cross-tenant read)", async () => {
    await request(app.getHttpServer())
      .get(`/canal-entrada/${CANAL_B}`)
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(404);
  });

  it('PATCH /canal-entrada/:id of another tenant returns 404 (no cross-tenant write)', async () => {
    await request(app.getHttpServer())
      .patch(`/canal-entrada/${CANAL_B}`)
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .send({ nombre: 'hijacked' })
      .expect(404);

    // Confirm B's row was NOT modified.
    const [row] = await ds.query(`SELECT nombre FROM canal_entrada WHERE id = $1`, [CANAL_B]);
    expect(row.nombre).toBe('Canal B');
  });

  it('DELETE /canal-entrada/:id of another tenant returns 404 (no cross-tenant delete)', async () => {
    await request(app.getHttpServer())
      .delete(`/canal-entrada/${CANAL_B}`)
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(404);

    const rows = await ds.query(`SELECT 1 FROM canal_entrada WHERE id = $1`, [CANAL_B]);
    expect(rows).toHaveLength(1); // still there
  });

  it('POST /canal-entrada always stamps the caller tenant (body cannot override)', async () => {
    const res = await request(app.getHttpServer())
      .post('/canal-entrada')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .send({ nombre: 'Nuevo', tipo: 'whatsapp', client_id: CLIENT_B })
      .expect(201);

    expect(res.body.client_id).toBe(CLIENT_A);
  });
});
