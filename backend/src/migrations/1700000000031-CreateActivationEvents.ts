import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateActivationEvents1700000000031 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE activation_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id       UUID NOT NULL,
        activation_id   UUID NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
        event_type      VARCHAR(20) NOT NULL,
        location_status VARCHAR(20),
        lat             DOUBLE PRECISION,
        lng             DOUBLE PRECISION,
        content         TEXT,
        media_url       VARCHAR(1000),
        metadata        JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_activation_events_activation ON activation_events(activation_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_activation_events_client ON activation_events(client_id, event_type)`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN activation_events.event_type IS 'LOCATION_CHECK | REPORT | PHOTO | INCIDENT'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN activation_events.location_status IS 'VERIFIED | MISMATCH | PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS activation_events CASCADE`);
  }
}
