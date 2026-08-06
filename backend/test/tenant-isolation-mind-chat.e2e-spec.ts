import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { MindChatService, QUERY_CATALOG } from '../src/modules/mind/mind-chat.service';
import { PromptShieldService } from '../src/common/ai/prompt-shield.service';
import { DB, ENTITIES_GLOB } from './helpers';

// CAT 2 — agujero más grave del audit: SQL generado por IA (mind-chat:277).
// El rediseño elimina el SQL libre: el modelo sólo elige una query_key de un
// catálogo cerrado, y cada SQL trae client_id = $1 hardcodeado server-side.
// Estos tests prueban que NO hay forma de leer datos de otro tenant.

const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();
const SKU_A = randomUUID();
const SKU_B = randomUUID();
const BODEGA_A = randomUUID();
const BODEGA_B = randomUUID();

describe('Tenant isolation — mind-chat catálogo de queries (CAT 2)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: MindChatService;

  // Corre una query del catálogo y devuelve las filas parseadas.
  const run = async (key: string, clientId: string): Promise<any[]> =>
    JSON.parse(await (service as any).executeCatalogQuery(key, clientId));

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
      providers: [MindChatService, PromptShieldService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    ds = moduleRef.get(DataSource);
    service = moduleRef.get(MindChatService);

    // ── Seed: dos tenants con datos distinguibles por marcador (A vs B) ──
    await ds.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active'), ($2,'Tenant B','active')`,
      [CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO projects (id, client_id, name, status) VALUES
        ($1,$3,'Proj A','active'), ($2,$4,'Proj B','active')`,
      [PROJECT_A, PROJECT_B, CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO rendiciones (id, client_id, persona_id, project_id, periodo, estado, monto_total) VALUES
        ($1,$3,$5,$7,'2026-W20','enviada',111111),
        ($2,$4,$6,$8,'2026-W20','enviada',222222)`,
      [randomUUID(), randomUUID(), CLIENT_A, CLIENT_B, randomUUID(), randomUUID(), PROJECT_A, PROJECT_B],
    );
    await ds.query(
      `INSERT INTO invoices (id, client_id, vendor_name, amount, status, category) VALUES
        ($1,$3,'Vendor A',333333,'pending','cost'),
        ($2,$4,'Vendor B',444444,'pending','cost')`,
      [randomUUID(), randomUUID(), CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO skus (id, client_id, codigo, nombre, min_stock, active) VALUES
        ($1,$3,'SKU-A','Sku A',100,true), ($2,$4,'SKU-B','Sku B',100,true)`,
      [SKU_A, SKU_B, CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO bodegas (id, client_id, nombre, active) VALUES
        ($1,$3,'Bodega A',true), ($2,$4,'Bodega B',true)`,
      [BODEGA_A, BODEGA_B, CLIENT_A, CLIENT_B],
    );
    await ds.query(
      `INSERT INTO inventario (id, client_id, sku_id, bodega_id, cantidad) VALUES
        ($1,$3,$5,$7,5), ($2,$4,$6,$8,9)`,
      [randomUUID(), randomUUID(), CLIENT_A, CLIENT_B, SKU_A, SKU_B, BODEGA_A, BODEGA_B],
    );
    await ds.query(
      `INSERT INTO movimientos_pop (id, client_id, sku_id, tipo, estado, cantidad) VALUES
        ($1,$3,$5,'salida','en_terreno',5),
        ($2,$4,$6,'salida','en_terreno',9)`,
      [randomUUID(), randomUUID(), CLIENT_A, CLIENT_B, SKU_A, SKU_B],
    );
    await ds.query(
      `INSERT INTO mind_propuestas (id, client_id, titulo, estado) VALUES
        ($1,$3,'Prop A','abierta'), ($2,$4,'Prop B','abierta')`,
      [randomUUID(), randomUUID(), CLIENT_A, CLIENT_B],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      const both = [CLIENT_A, CLIENT_B];
      for (const t of [
        'movimientos_pop', 'inventario', 'mind_propuestas', 'invoices',
        'rendiciones', 'skus', 'bodegas', 'projects',
      ]) {
        await ds.query(`DELETE FROM ${t} WHERE client_id = ANY($1)`, [both]);
      }
      await ds.query(`DELETE FROM clients WHERE id = ANY($1)`, [both]);
    }
    await app?.close();
  });

  // ── 1. Invariante estructural: el catálogo es la única superficie de SQL ──
  it('every catalog entry hardcodes client_id = $1', () => {
    const keys = Object.keys(QUERY_CATALOG);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const sql = QUERY_CATALOG[key].sql;
      // El filtro de tenant debe estar presente como literal — no opcional.
      expect(sql).toMatch(/client_id\s*=\s*\$1/);
      // El modelo no puede inyectar otro tenant: $1 es el único parámetro.
      expect(sql).not.toMatch(/\$[2-9]/);
    }
  });

  // ── 2. El modelo no puede salirse del catálogo ──
  it('rejects an unknown query_key (no free-form SQL possible)', async () => {
    await expect(
      (service as any).executeCatalogQuery('SELECT * FROM users', CLIENT_A),
    ).rejects.toThrow(/inválida/i);
    await expect(
      (service as any).executeCatalogQuery('drop_tables', CLIENT_A),
    ).rejects.toThrow(/inválida/i);
  });

  // ── 3. Toda query del catálogo corre sin error contra el esquema real ──
  // (atrapa columnas fantasma) y NO devuelve datos de otro tenant.
  it('runs every catalog query for CLIENT_A without leaking CLIENT_B data', async () => {
    for (const key of Object.keys(QUERY_CATALOG)) {
      const raw = await (service as any).executeCatalogQuery(key, CLIENT_A);
      // Ningún marcador del tenant B debe aparecer jamás en la salida de A.
      for (const markerB of ['Proj B', 'Vendor B', 'SKU-B', 'Sku B', 'Bodega B', 'Prop B', '222222', '444444']) {
        expect(raw).not.toContain(markerB);
      }
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });

  // ── 4. Leak checks puntuales por query (positivo + negativo) ──
  it('proyectos_activos returns only the caller tenant projects', async () => {
    const rows = await run('proyectos_activos', CLIENT_A);
    expect(rows.map(r => r.name)).toContain('Proj A');
    expect(rows.map(r => r.name)).not.toContain('Proj B');
  });

  it('invoices_pendientes returns only the caller tenant invoices', async () => {
    const rows = await run('invoices_pendientes', CLIENT_A);
    expect(rows.map(r => r.vendor_name)).toEqual(['Vendor A']);
  });

  it('stock_por_bodega returns only the caller tenant bodegas', async () => {
    const rows = await run('stock_por_bodega', CLIENT_A);
    expect(rows.map(r => r.nombre)).toEqual(['Bodega A']);
  });

  it('propuestas_abiertas returns only the caller tenant proposals', async () => {
    const rows = await run('propuestas_abiertas', CLIENT_A);
    expect(rows.map(r => r.titulo)).toEqual(['Prop A']);
  });
});
