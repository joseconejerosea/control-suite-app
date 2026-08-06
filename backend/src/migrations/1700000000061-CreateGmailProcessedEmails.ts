import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gmail poll — marca de correos ya procesados (anti-reprocesamiento).
 *
 * `pollInbox` lista los correos de los últimos 15 min en CADA poll (cada 10s). El
 * único dedup previo era contra `invoices` por gmail_id, así que SOLO las facturas
 * ya guardadas se saltaban. Un correo que NO es factura (feedback o basura) no se
 * guarda en `invoices` → se re-leía y se le corría extracción con IA en cada poll
 * durante los 15 min de la ventana (~90 llamadas al modelo por un mismo correo).
 *
 * Esta tabla registra CADA correo que llegó a un desenlace terminal
 * (invoice | feedback | ignored) para que el próximo poll lo saltee. Tenant-scoped
 * + RLS, mismo patrón endurecido (NULLIF + WITH CHECK) que gmail_tokens (042).
 */

const TENANT_EXPR = `NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

export class CreateGmailProcessedEmails1700000000061
  implements MigrationInterface
{
  name = 'CreateGmailProcessedEmails1700000000061';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS gmail_processed_emails (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        gmail_id   VARCHAR(255) NOT NULL,
        outcome    VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT gmail_processed_emails_client_gmail_key UNIQUE (client_id, gmail_id),
        CONSTRAINT chk_gmail_processed_outcome CHECK (outcome IN ('invoice','feedback','ignored'))
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_gmail_processed_client ON gmail_processed_emails(client_id)`,
    );

    await q.query(`ALTER TABLE gmail_processed_emails ENABLE ROW LEVEL SECURITY`);
    await q.query(
      `DROP POLICY IF EXISTS rls_gmail_processed_tenant_isolation ON gmail_processed_emails`,
    );
    await q.query(`
      CREATE POLICY rls_gmail_processed_tenant_isolation ON gmail_processed_emails
        USING (client_id = ${TENANT_EXPR})
        WITH CHECK (client_id = ${TENANT_EXPR})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP POLICY IF EXISTS rls_gmail_processed_tenant_isolation ON gmail_processed_emails`,
    );
    await q.query(`DROP TABLE IF EXISTS gmail_processed_emails`);
  }
}
