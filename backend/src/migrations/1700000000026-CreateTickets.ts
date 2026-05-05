import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTickets1700000000026 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        client_id    UUID REFERENCES clients(id) ON DELETE SET NULL,
        user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        tipo         VARCHAR(100) NOT NULL,
        descripcion  TEXT NOT NULL,
        prioridad    VARCHAR(20) NOT NULL DEFAULT 'media',
        estado       VARCHAR(30) NOT NULL DEFAULT 'abierto',
        respuesta    TEXT,
        respondido_por UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_tickets_client_estado ON tickets(client_id, estado)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS tickets`);
  }
}
