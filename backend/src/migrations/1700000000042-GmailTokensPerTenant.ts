import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * C3 (audit) — gmail_tokens pasa de "buzón global" a per-tenant.
 *
 * Estado previo (migración 018): tabla con email UNIQUE y SIN client_id. El
 * runtime, sin embargo, insertaba (email, tokens, client_id) → drift de schema
 * (la columna se había agregado a mano en la DB) y, peor, un solo buzón
 * GMAIL_EMAIL compartido por todos los clientes (ON CONFLICT (email) → el
 * segundo tenant pisaba el client_id del primero).
 *
 * Esta migración:
 *  1) Garantiza la columna client_id (idempotente: resuelve el drift).
 *  2) Reemplaza UNIQUE(email) por UNIQUE(client_id, email): el mismo correo
 *     puede existir para tenants distintos; un tenant no pisa al otro.
 *  3) FK a clients (ON DELETE CASCADE).
 *  4) RLS — gmail_tokens es tabla tenant. Mismo patrón endurecido que 039/040
 *     (NULLIF + WITH CHECK). Inerte hasta el switch al rol sin BYPASSRLS (E6).
 */

const TENANT_EXPR = `NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

export class GmailTokensPerTenant1700000000042 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // 1) Columna tenant (idempotente — puede haberse agregado a mano).
    await q.query(`ALTER TABLE gmail_tokens ADD COLUMN IF NOT EXISTS client_id UUID`);

    // 2) El email deja de ser global.
    await q.query(`ALTER TABLE gmail_tokens DROP CONSTRAINT IF EXISTS gmail_tokens_email_key`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'gmail_tokens_client_email_key'
        ) THEN
          ALTER TABLE gmail_tokens
            ADD CONSTRAINT gmail_tokens_client_email_key UNIQUE (client_id, email);
        END IF;
      END $$
    `);

    // 3) FK al tenant.
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'gmail_tokens_client_id_fkey'
        ) THEN
          ALTER TABLE gmail_tokens
            ADD CONSTRAINT gmail_tokens_client_id_fkey
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
        END IF;
      END $$
    `);

    // 4) RLS.
    await q.query(`ALTER TABLE gmail_tokens ENABLE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS rls_gmail_tokens_tenant_isolation ON gmail_tokens`);
    await q.query(`
      CREATE POLICY rls_gmail_tokens_tenant_isolation ON gmail_tokens
        USING (client_id = ${TENANT_EXPR})
        WITH CHECK (client_id = ${TENANT_EXPR})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP POLICY IF EXISTS rls_gmail_tokens_tenant_isolation ON gmail_tokens`);
    await q.query(`ALTER TABLE gmail_tokens DISABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE gmail_tokens DROP CONSTRAINT IF EXISTS gmail_tokens_client_id_fkey`);
    await q.query(`ALTER TABLE gmail_tokens DROP CONSTRAINT IF EXISTS gmail_tokens_client_email_key`);
    // No se re-crea UNIQUE(email) ni se borra client_id: el esquema per-tenant queda.
  }
}
