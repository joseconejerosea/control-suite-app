import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateF5Tables1700000000025 implements MigrationInterface {
  name = 'CreateF5Tables1700000000025';

  async up(qr: QueryRunner): Promise<void> {
    /* ── checkins ────────────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE checkins (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id      UUID NOT NULL,
        activacion_id  UUID NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
        persona_id     UUID NOT NULL,
        foto_key       VARCHAR(512),
        observacion    TEXT,
        verificacion_ia JSONB,
        ts             TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_checkins_activacion ON checkins(activacion_id)`);
    await qr.query(`CREATE INDEX idx_checkins_persona ON checkins(client_id, persona_id)`);

    /* ── montaje_evidencias ──────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE montaje_evidencias (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id      UUID NOT NULL,
        activacion_id  UUID NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
        tipo           VARCHAR(20) NOT NULL DEFAULT 'general',
        sku_id         UUID,
        foto_key       VARCHAR(512) NOT NULL,
        hora_inicio_oficial TIMESTAMPTZ,
        observaciones  TEXT,
        ts             TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_montaje_activacion ON montaje_evidencias(activacion_id)`);

    /* ── incidencias ─────────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE incidencias (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id        UUID NOT NULL,
        activacion_id    UUID NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
        persona_id       UUID,
        descripcion      TEXT NOT NULL,
        foto_key         VARCHAR(512),
        categoria        VARCHAR(40),
        severidad        VARCHAR(20) NOT NULL DEFAULT 'baja',
        accion_sugerida  TEXT,
        estado           VARCHAR(20) NOT NULL DEFAULT 'abierta',
        resuelta_at      TIMESTAMPTZ,
        resuelta_por_user_id UUID,
        raw_event_id     UUID,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_incidencias_activacion ON incidencias(activacion_id, estado)`);
    await qr.query(`CREATE INDEX idx_incidencias_client ON incidencias(client_id, severidad, estado)`);

    /* ── reportes_avance ─────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE reportes_avance (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id      UUID NOT NULL,
        activacion_id  UUID NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
        momento        VARCHAR(10) NOT NULL,
        foto_keys      TEXT[],
        metricas_jsonb JSONB,
        observacion    TEXT,
        persona_id     UUID,
        ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_reporte_avance UNIQUE (activacion_id, momento)
      )
    `);
    await qr.query(`CREATE INDEX idx_reportes_avance_activacion ON reportes_avance(activacion_id)`);

    /* ── reportes_cliente ────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE reportes_cliente (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id             UUID NOT NULL,
        activacion_id         UUID NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
        version_interna_jsonb JSONB,
        version_cliente_jsonb JSONB,
        aprobado_por_user_id  UUID,
        aprobado_at           TIMESTAMPTZ,
        enviado_at            TIMESTAMPTZ,
        destinatarios         TEXT[],
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_reportes_cliente_activacion ON reportes_cliente(activacion_id)`);

    /* ── Extend activations table for F5 ────────────────────────────────── */
    await qr.query(`
      ALTER TABLE activations
        ADD COLUMN IF NOT EXISTS estado_f5       VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        ADD COLUMN IF NOT EXISTS cerrada_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS cierre_jsonb    JSONB,
        ADD COLUMN IF NOT EXISTS cierre_incompleto BOOLEAN NOT NULL DEFAULT false
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS reportes_cliente CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS reportes_avance CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS incidencias CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS montaje_evidencias CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS checkins CASCADE`);
  }
}
