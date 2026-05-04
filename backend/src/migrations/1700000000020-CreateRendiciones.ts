import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRendiciones1700000000020 implements MigrationInterface {
  name = 'CreateRendiciones1700000000020';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE rendiciones (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id     UUID NOT NULL,
        persona_id    UUID NOT NULL,
        project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
        periodo       VARCHAR(10)  NOT NULL,   -- ISO week e.g. '2026-W43'
        estado        VARCHAR(20)  NOT NULL DEFAULT 'borrador',
        monto_total   DECIMAL(14,2) NOT NULL DEFAULT 0,
        porcentaje_presupuesto DECIMAL(6,2),
        aprobada_auto  BOOLEAN     NOT NULL DEFAULT false,
        aprobada_at    TIMESTAMPTZ,
        aprobada_por_user_id UUID,
        rechazada_at   TIMESTAMPTZ,
        rechazada_motivo TEXT,
        pagada_at      TIMESTAMPTZ,
        comprobante_pago_key VARCHAR(512),
        requiere_admin BOOLEAN NOT NULL DEFAULT false,
        excede_por_clp DECIMAL(14,2),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    await qr.query(`
      CREATE TABLE rendicion_items (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id      UUID NOT NULL,
        rendicion_id   UUID NOT NULL REFERENCES rendiciones(id) ON DELETE CASCADE,
        invoice_id     UUID REFERENCES invoices(id) ON DELETE SET NULL,
        monto          DECIMAL(14,2) NOT NULL DEFAULT 0,
        descripcion    TEXT,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    await qr.query(`CREATE INDEX idx_rendiciones_client_id    ON rendiciones(client_id, estado, periodo DESC)`);
    await qr.query(`CREATE INDEX idx_rendiciones_persona_id   ON rendiciones(client_id, persona_id)`);
    await qr.query(`CREATE INDEX idx_rendiciones_project_id   ON rendiciones(client_id, project_id)`);
    await qr.query(`CREATE INDEX idx_rendicion_items_rendicion ON rendicion_items(rendicion_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS rendicion_items CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS rendiciones CASCADE`);
  }
}
