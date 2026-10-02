import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the dead legacy `f1_inbound_channels` table.
 *
 * Created by the original F1 schema (migration 19) as an inbound-channel registry,
 * it was fully superseded by `canal_entrada` and has ZERO references in application
 * code (verified repo-wide: only migrations 19 and 40 mention it; no entity, service,
 * query, or foreign key uses it). Its `wa_phone_number_id` column surfaced during the
 * single-global-number review as orphaned state — but the whole table is dead, so we
 * drop it rather than just the column.
 *
 * down() recreates the empty table structure (from migration 19) for reversibility;
 * it does NOT restore data (there is no source of truth) nor the RLS policy (migration
 * 40 owns that and is reverted separately).
 */
export class DropDeadF1InboundChannels1700000000070 implements MigrationInterface {
  name = 'DropDeadF1InboundChannels1700000000070';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS f1_inbound_channels`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS f1_inbound_channels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        canal VARCHAR(20) NOT NULL,
        wa_phone_number_id VARCHAR(40),
        wa_webhook_secret VARCHAR(200),
        email_address VARCHAR(160),
        email_oauth_refresh_token_enc TEXT,
        email_provider VARCHAR(20),
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_f1_channels_client ON f1_inbound_channels (client_id, canal, activo)`,
    );
  }
}
