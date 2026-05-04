import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateF4Extensions1700000000024 implements MigrationInterface {
  name = 'CreateF4Extensions1700000000024';

  async up(qr: QueryRunner): Promise<void> {
    /* ── Extend projects table for F4 ───────────────────────────────────── */
    await qr.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS cliente_final       VARCHAR(255),
        ADD COLUMN IF NOT EXISTS cliente_final_rut   VARCHAR(20),
        ADD COLUMN IF NOT EXISTS presupuesto_clp     DECIMAL(14,2),
        ADD COLUMN IF NOT EXISTS costo_estimado_clp  DECIMAL(14,2),
        ADD COLUMN IF NOT EXISTS margen_proyectado_pct DECIMAL(6,2),
        ADD COLUMN IF NOT EXISTS brief               TEXT,
        ADD COLUMN IF NOT EXISTS armado_por_ia       BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS aprobado_por_user_id UUID,
        ADD COLUMN IF NOT EXISTS aprobado_at         TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS version             INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS doc_brief_key       VARCHAR(512),
        ADD COLUMN IF NOT EXISTS hitos               JSONB,
        ADD COLUMN IF NOT EXISTS locales_jsonb       JSONB,
        ADD COLUMN IF NOT EXISTS material_pop_jsonb  JSONB
    `);

    /* ── proyecto_versiones (snapshots) ─────────────────────────────────── */
    await qr.query(`
      CREATE TABLE IF NOT EXISTS proyecto_versiones (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id            UUID NOT NULL,
        proyecto_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        version              INTEGER NOT NULL,
        snapshot_jsonb       JSONB NOT NULL,
        cambio_descripcion   TEXT,
        autor_user_id        UUID,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_proyecto_versiones ON proyecto_versiones(proyecto_id, version DESC)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS proyecto_versiones CASCADE`);
  }
}
