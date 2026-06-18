import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { BodegasService } from '../src/modules/bodegas/bodegas.service';
import { DB, ENTITIES_GLOB } from './helpers';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const BODEGA_A = randomUUID();
const BODEGA_B = randomUUID();

describe('Tenant isolation — bodegas update (CAT 2: placeholder bug)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: BodegasService;

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
      providers: [BodegasService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    ds = moduleRef.get(DataSource);
    service = moduleRef.get(BodegasService);

    await ds.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO bodegas (id, client_id, nombre) VALUES ($1,$3,'Bodega A'), ($2,$4,'Bodega B')`,
      [BODEGA_A, BODEGA_B, CLIENT_A, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM bodegas WHERE id = ANY($1)`, [[BODEGA_A, BODEGA_B]]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
    }
    await app?.close();
  });

  it('updates own bodega (placeholder bug fixed — no SQL error)', async () => {
    // Before the fix, the malformed `client_id=${i}` compared a uuid column to an
    // integer and threw a SQL error. This call must now succeed.
    await service.update(CLIENT_A, BODEGA_A, { nombre: 'Bodega A renamed' });

    // Verify the real DB effect (robust to TypeORM's UPDATE return shape).
    const [row] = await ds.query(`SELECT nombre, client_id FROM bodegas WHERE id=$1`, [BODEGA_A]);
    expect(row.nombre).toBe('Bodega A renamed');
    expect(row.client_id).toBe(CLIENT_A);
  });

  it("rejects updating another tenant's bodega (404)", async () => {
    await expect(
      service.update(CLIENT_A, BODEGA_B, { nombre: 'hijacked' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const [row] = await ds.query(`SELECT nombre FROM bodegas WHERE id=$1`, [BODEGA_B]);
    expect(row.nombre).toBe('Bodega B');
  });
});
