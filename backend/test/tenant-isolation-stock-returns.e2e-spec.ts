import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { StockReturnsService } from '../src/modules/movimientos-pop/stock-returns.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { DB, ENTITIES_GLOB, configServiceProvider } from './helpers';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PROMOTER_A = randomUUID();
const PROMOTER_B = randomUUID();

describe('Tenant isolation — stock-returns resolvePhone (CAT 2: cross-tenant phone)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: StockReturnsService;

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
      providers: [
        StockReturnsService,
        { provide: WhatsAppService, useValue: { sendText: async () => true } },
        { provide: AuditService, useValue: { log: async () => undefined } },
        configServiceProvider,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    ds = moduleRef.get(DataSource);
    service = moduleRef.get(StockReturnsService);

    await ds.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO promoters (id, client_id, name, phone) VALUES ($1,$3,'Promo A','+11111111'), ($2,$4,'Promo B','+22222222')`,
      [PROMOTER_A, PROMOTER_B, CLIENT_A, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM promoters WHERE id = ANY($1)`, [[PROMOTER_A, PROMOTER_B]]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
    }
    await app?.close();
  });

  it("resolvePhone of another tenant's persona returns null (no cross-tenant phone leak)", async () => {
    const phone = await (service as any).resolvePhone(PROMOTER_B, CLIENT_A);
    expect(phone).toBeNull();
  });

  it('resolvePhone of own persona works', async () => {
    const phone = await (service as any).resolvePhone(PROMOTER_A, CLIENT_A);
    expect(phone).toBe('+11111111');
  });
});
