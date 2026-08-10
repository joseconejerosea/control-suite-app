import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the generic in-app notifications table.
 *
 * Design decision: one row per recipient (N users → N rows) so that read_at
 * is per-user without needing a join table or a session-var RLS on user_id.
 * RLS scopes the table by client_id (tenant). The user_id predicate in SQL
 * enforces own-only reads/writes — users table is outside RLS so no RLS on user_id.
 *
 * No FK on user_id (mirrors checkins.persona_id pattern: the sender can be a
 * promoter, collaborator, or user — heterogeneous IDs).
 */
const TENANT_EXPR = `NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

export class CreateNotifications1700000000064 implements MigrationInterface {
  name = 'CreateNotifications1700000000064';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id  UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        user_id    UUID        NOT NULL,
        type       VARCHAR(40) NOT NULL,
        title      VARCHAR(200) NOT NULL,
        body       TEXT,
        metadata   JSONB,
        read_at    TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_unread
         ON notifications (client_id, user_id, read_at)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_created
         ON notifications (client_id, created_at DESC)`,
    );

    await q.query(`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`);
    await q.query(
      `DROP POLICY IF EXISTS rls_notifications_tenant_isolation ON notifications`,
    );
    await q.query(`
      CREATE POLICY rls_notifications_tenant_isolation ON notifications
        USING     (client_id = ${TENANT_EXPR})
        WITH CHECK (client_id = ${TENANT_EXPR})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP POLICY IF EXISTS rls_notifications_tenant_isolation ON notifications`,
    );
    await q.query(`DROP TABLE IF EXISTS notifications`);
  }
}
