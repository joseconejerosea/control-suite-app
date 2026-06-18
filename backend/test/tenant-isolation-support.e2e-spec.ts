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
import { SupportController } from '../src/modules/support/support.controller';
import { SupportService } from '../src/modules/support/support.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { DB, ENTITIES_GLOB, configServiceProvider, tokenFor } from './helpers';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const TICKET_A1 = randomUUID();
const TICKET_A2 = randomUUID();
const TICKET_B1 = randomUUID();
const TICKET_B2 = randomUUID();
const TICKET_B3 = randomUUID();

describe('Tenant isolation — support tickets (CAT 2)', () => {
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
      controllers: [SupportController],
      providers: [
        SupportService,
        { provide: WhatsAppService, useValue: { sendText: async () => true } },
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
    // A: 2 tickets, B: 3 tickets.
    await ds.query(
      `INSERT INTO tickets (id, client_id, tipo, descripcion) VALUES
         ($1,$6,'bug','a1'), ($2,$6,'bug','a2'),
         ($3,$7,'bug','b1'), ($4,$7,'bug','b2'), ($5,$7,'bug','b3')`,
      [TICKET_A1, TICKET_A2, TICKET_B1, TICKET_B2, TICKET_B3, CLIENT_A, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM tickets WHERE client_id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
    }
    await app?.close();
  });

  it("GET /support/tickets/:id of another tenant returns 404 (no IDOR)", async () => {
    await request(app.getHttpServer())
      .get(`/support/tickets/${TICKET_B1}`)
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(404);
  });

  it('GET /support/tickets/:id of own tenant still works (200)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/support/tickets/${TICKET_A1}`)
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(200);
    expect(res.body.client_id).toBe(CLIENT_A);
  });

  it('GET /support/tickets/kpis counts ONLY the caller tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/support/tickets/kpis')
      .set('Authorization', `Bearer ${tokenFor(CLIENT_A)}`)
      .expect(200);
    // A has 2 tickets; must NOT see the global 5.
    expect(Number(res.body.total)).toBe(2);
  });
});
