import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventarioPOP1700000000021 implements MigrationInterface {
  name = 'CreateInventarioPOP1700000000021';

  async up(qr: QueryRunner): Promise<void> {
    /* ── Bodegas ─────────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE bodegas (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id       UUID NOT NULL,
        nombre          VARCHAR(255) NOT NULL,
        direccion       TEXT,
        encargado_persona_id UUID,
        tipo            VARCHAR(30) NOT NULL DEFAULT 'principal',
        active          BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_bodegas_client_id ON bodegas(client_id, active)`);

    /* ── SKUs ────────────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE skus (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id              UUID NOT NULL,
        codigo                 VARCHAR(100) NOT NULL,
        nombre                 VARCHAR(255) NOT NULL,
        cliente_final          VARCHAR(255),
        dimensiones            VARCHAR(255),
        peso_kg                DECIMAL(8,3),
        valor_unitario         DECIMAL(14,2),
        proveedor_fabricacion  VARCHAR(255),
        fabricado_at           DATE,
        foto_key               VARCHAR(512),
        ficha_tecnica_key      VARCHAR(512),
        tipo                   VARCHAR(20) NOT NULL DEFAULT 'reusable',
        active                 BOOLEAN NOT NULL DEFAULT true,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_skus_codigo UNIQUE (client_id, codigo)
      )
    `);
    await qr.query(`CREATE INDEX idx_skus_client_id ON skus(client_id, active)`);
    await qr.query(`CREATE INDEX idx_skus_cliente_final ON skus(client_id, cliente_final)`);

    /* ── Inventario ──────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE inventario (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id             UUID NOT NULL,
        sku_id                UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
        bodega_id             UUID NOT NULL REFERENCES bodegas(id) ON DELETE CASCADE,
        cantidad              INTEGER NOT NULL DEFAULT 0,
        ultimo_movimiento_at  TIMESTAMPTZ,
        CONSTRAINT uq_inventario_sku_bodega UNIQUE (client_id, sku_id, bodega_id)
      )
    `);
    await qr.query(`CREATE INDEX idx_inventario_client_id ON inventario(client_id)`);

    /* ── Movimientos POP ─────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE movimientos_pop (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id               UUID NOT NULL,
        sku_id                  UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
        persona_id              UUID,
        bodega_origen_id        UUID REFERENCES bodegas(id) ON DELETE SET NULL,
        proyecto_destino_id     UUID REFERENCES projects(id) ON DELETE SET NULL,
        tipo                    VARCHAR(20) NOT NULL,
        cantidad                INTEGER NOT NULL DEFAULT 0,
        foto_key                VARCHAR(512),
        tiempo_uso_dias         INTEGER,
        fecha_retorno_esperada  DATE,
        fecha_retorno_real      DATE,
        estado                  VARCHAR(30) NOT NULL DEFAULT 'en_terreno',
        observacion             TEXT,
        raw_event_id            UUID,
        activacion_id           UUID,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_movimientos_client_id ON movimientos_pop(client_id, tipo, estado)`);
    await qr.query(`CREATE INDEX idx_movimientos_sku_id    ON movimientos_pop(sku_id)`);
    await qr.query(`CREATE INDEX idx_movimientos_proyecto  ON movimientos_pop(proyecto_destino_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS movimientos_pop CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS inventario CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS skus CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS bodegas CASCADE`);
  }
}
