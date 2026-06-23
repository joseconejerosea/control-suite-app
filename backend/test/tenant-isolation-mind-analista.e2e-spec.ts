import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { MindAnalistaService } from '../src/modules/mind/mind-analista.service';
import { DB, ENTITIES_GLOB } from './helpers';

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();

describe('Tenant isolation — mind-analista cierre de proyecto (CAT 2)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: MindAnalistaService;

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
      providers: [MindAnalistaService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    ds = moduleRef.get(DataSource);
    service = moduleRef.get(MindAnalistaService);

    await ds.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO projects (id, client_id, name) VALUES ($1,$3,'Proj A'), ($2,$4,'Proj B')`,
      [PROJECT_A, PROJECT_B, CLIENT_A, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM projects WHERE id = ANY($1)`, [[PROJECT_A, PROJECT_B]]);
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [[CLIENT_A, CLIENT_B]]);
    }
    await app?.close();
  });

  it("rejects gathering another tenant's project data (NotFound, no financial leak)", async () => {
    await expect(
      (service as any).recopilarDatosProyecto(CLIENT_A, PROJECT_B),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gathers own project data', async () => {
    const datos: any = await (service as any).recopilarDatosProyecto(CLIENT_A, PROJECT_A);
    expect(datos.proyecto.client_id).toBe(CLIENT_A);
  });
});
