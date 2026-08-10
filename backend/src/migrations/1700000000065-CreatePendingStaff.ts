import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the pending_staff table — roster-gap queue for unknown promoters
 * detected during evidence intake (EvidenceIntakeService.escalate).
 *
 * Design decisions:
 * - UNIQUE(client_id, phone): same phone per tenant yields a single row; ON CONFLICT
 *   updates motivo/contexto without resetting estado (agregado/descartado stays).
 * - CHECK(estado IN ('pendiente','agregado','descartado')): DB-level enum guard.
 * - RLS scoped by client_id (tenant). Writes from the WhatsApp @Public path must
 *   wrap in runWithTenant; controller path uses the global TenantInterceptor.
 * - No FK on phone — promoter may not exist yet (that is the point of this table).
 */
const TENANT_EXPR = `NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

export class CreatePendingStaff1700000000065 implements MigrationInterface {
  name = 'CreatePendingStaff1700000000065';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS pending_staff (
        id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id  UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        phone      VARCHAR(30)  NOT NULL,
        motivo     VARCHAR(60),
        contexto   JSONB,
        estado     VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
        created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT pending_staff_client_phone_key UNIQUE (client_id, phone),
        CONSTRAINT chk_pending_staff_estado CHECK (estado IN ('pendiente', 'agregado', 'descartado'))
      )
    `);

    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_pending_staff_estado
         ON pending_staff (client_id, estado)`,
    );

    await q.query(`ALTER TABLE pending_staff ENABLE ROW LEVEL SECURITY`);
    await q.query(
      `DROP POLICY IF EXISTS rls_pending_staff_tenant_isolation ON pending_staff`,
    );
    await q.query(`
      CREATE POLICY rls_pending_staff_tenant_isolation ON pending_staff
        USING     (client_id = ${TENANT_EXPR})
        WITH CHECK (client_id = ${TENANT_EXPR})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP POLICY IF EXISTS rls_pending_staff_tenant_isolation ON pending_staff`,
    );
    await q.query(`DROP TABLE IF EXISTS pending_staff`);
  }
}
