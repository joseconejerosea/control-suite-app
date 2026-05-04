import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMind1700000000022 implements MigrationInterface {
  name = 'CreateMind1700000000022';

  async up(qr: QueryRunner): Promise<void> {
    /* ── Mind Propuestas ─────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE mind_propuestas (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id             UUID NOT NULL,
        tipo                  VARCHAR(20) NOT NULL DEFAULT 'proactivo',
        perfil_origen         VARCHAR(30),
        titulo                VARCHAR(512) NOT NULL,
        descripcion           TEXT,
        severidad             VARCHAR(20) NOT NULL DEFAULT 'media',
        accion_propuesta      JSONB,
        estado                VARCHAR(20) NOT NULL DEFAULT 'abierta',
        expira_at             TIMESTAMPTZ,
        aprobada_por_user_id  UUID,
        aprobada_at           TIMESTAMPTZ,
        rechazada_motivo      TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_mind_propuestas_client_id ON mind_propuestas(client_id, estado, created_at DESC)`);

    /* ── Mind Acciones Log ───────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE mind_acciones_log (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id            UUID NOT NULL,
        propuesta_id         UUID REFERENCES mind_propuestas(id) ON DELETE SET NULL,
        accion_ejecutada     JSONB,
        resultado            JSONB,
        aprobada_por_user_id UUID,
        ts                   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_mind_acciones_client_id ON mind_acciones_log(client_id, ts DESC)`);

    /* ── Mind Chat History ───────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE mind_chat_history (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id    UUID NOT NULL,
        user_id      UUID NOT NULL,
        role         VARCHAR(20) NOT NULL DEFAULT 'user',
        mensaje      TEXT NOT NULL,
        tools_used   JSONB,
        ts           TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_mind_chat_client_user ON mind_chat_history(client_id, user_id, ts DESC)`);

    /* ── AI Costs Log ────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE ai_costs_log (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id      UUID NOT NULL,
        user_id        UUID,
        model          VARCHAR(100),
        input_tokens   INTEGER,
        output_tokens  INTEGER,
        cost_usd       DECIMAL(10,6),
        duration_ms    INTEGER,
        perfil_origen  VARCHAR(50),
        contexto       JSONB,
        ts             TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_ai_costs_client_id ON ai_costs_log(client_id, ts DESC)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS ai_costs_log CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS mind_chat_history CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS mind_acciones_log CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS mind_propuestas CASCADE`);
  }
}
