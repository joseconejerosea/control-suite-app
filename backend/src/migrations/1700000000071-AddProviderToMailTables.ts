import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-provider mail ingestion — agrega `provider` a las tablas de correo para
 * que Gmail y Outlook coexistan en el mismo tenant sin pisarse.
 *
 * - `provider` es NOT NULL DEFAULT 'gmail': Postgres backfillea las filas
 *   existentes a 'gmail' en un solo paso (todas eran Gmail). CRÍTICO: SheetsService
 *   lee gmail_tokens y ahora filtra provider='gmail' (los tokens de Outlook NO
 *   tienen el scope spreadsheets) — el backfill garantiza que las filas actuales
 *   sigan matcheando ese filtro.
 * - El UNIQUE deja de ser (client_id, email) → (client_id, provider, email): el
 *   mismo correo puede estar conectado por dos providers sin colisión.
 * - Idem gmail_processed_emails: el dedup de correos procesados pasa a
 *   (client_id, provider, gmail_id).
 *
 * Los nombres de tabla (gmail_tokens / gmail_processed_emails) se conservan a
 * propósito: renombrarlos en vivo es riesgo sin beneficio. `gmail_id` pasa a
 * significar "id del mensaje del provider".
 */
export class AddProviderToMailTables1700000000071 implements MigrationInterface {
  name = 'AddProviderToMailTables1700000000071';

  public async up(q: QueryRunner): Promise<void> {
    // ── gmail_tokens ──────────────────────────────────────────────────────────
    await q.query(
      `ALTER TABLE gmail_tokens ADD COLUMN IF NOT EXISTS provider VARCHAR(16) NOT NULL DEFAULT 'gmail'`,
    );
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_gmail_tokens_provider') THEN
          ALTER TABLE gmail_tokens
            ADD CONSTRAINT chk_gmail_tokens_provider CHECK (provider IN ('gmail','outlook'));
        END IF;
      END $$
    `);
    await q.query(`ALTER TABLE gmail_tokens DROP CONSTRAINT IF EXISTS gmail_tokens_client_email_key`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'gmail_tokens_client_provider_email_key'
        ) THEN
          ALTER TABLE gmail_tokens
            ADD CONSTRAINT gmail_tokens_client_provider_email_key UNIQUE (client_id, provider, email);
        END IF;
      END $$
    `);

    // ── gmail_processed_emails ────────────────────────────────────────────────
    await q.query(
      `ALTER TABLE gmail_processed_emails ADD COLUMN IF NOT EXISTS provider VARCHAR(16) NOT NULL DEFAULT 'gmail'`,
    );
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_gmail_processed_provider') THEN
          ALTER TABLE gmail_processed_emails
            ADD CONSTRAINT chk_gmail_processed_provider CHECK (provider IN ('gmail','outlook'));
        END IF;
      END $$
    `);
    await q.query(
      `ALTER TABLE gmail_processed_emails DROP CONSTRAINT IF EXISTS gmail_processed_emails_client_gmail_key`,
    );
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'gmail_processed_emails_client_provider_gmail_key'
        ) THEN
          ALTER TABLE gmail_processed_emails
            ADD CONSTRAINT gmail_processed_emails_client_provider_gmail_key
            UNIQUE (client_id, provider, gmail_id);
        END IF;
      END $$
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE gmail_processed_emails DROP CONSTRAINT IF EXISTS gmail_processed_emails_client_provider_gmail_key`,
    );
    // Rollback a gmail-only: descartar filas no-gmail para poder recrear el UNIQUE más
    // angosto (client_id, gmail_id) sin fallar por duplicate-key.
    await q.query("DELETE FROM gmail_processed_emails WHERE provider <> 'gmail'");
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gmail_processed_emails_client_gmail_key') THEN
          ALTER TABLE gmail_processed_emails
            ADD CONSTRAINT gmail_processed_emails_client_gmail_key UNIQUE (client_id, gmail_id);
        END IF;
      END $$
    `);
    await q.query(`ALTER TABLE gmail_processed_emails DROP CONSTRAINT IF EXISTS chk_gmail_processed_provider`);
    await q.query(`ALTER TABLE gmail_processed_emails DROP COLUMN IF EXISTS provider`);

    await q.query(`ALTER TABLE gmail_tokens DROP CONSTRAINT IF EXISTS gmail_tokens_client_provider_email_key`);
    // Rollback a gmail-only: descartar filas no-gmail para poder recrear el UNIQUE más
    // angosto (client_id, email) sin fallar por duplicate-key.
    await q.query("DELETE FROM gmail_tokens WHERE provider <> 'gmail'");
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gmail_tokens_client_email_key') THEN
          ALTER TABLE gmail_tokens ADD CONSTRAINT gmail_tokens_client_email_key UNIQUE (client_id, email);
        END IF;
      END $$
    `);
    await q.query(`ALTER TABLE gmail_tokens DROP CONSTRAINT IF EXISTS chk_gmail_tokens_provider`);
    await q.query(`ALTER TABLE gmail_tokens DROP COLUMN IF EXISTS provider`);
  }
}
