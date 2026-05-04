import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvoices1700000000017 implements MigrationInterface {
  name = 'CreateInvoices1700000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE invoices (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,

        -- Where did this invoice come from?
        source          VARCHAR(20) NOT NULL DEFAULT 'manual',

        -- Core invoice fields (AI-extracted or manually entered)
        vendor_name     VARCHAR(255) NULL,
        amount          DECIMAL(14,2) NULL,
        currency        VARCHAR(10) NOT NULL DEFAULT 'CLP',
        invoice_date    DATE NULL,
        category        VARCHAR(20) NOT NULL DEFAULT 'cost',
        description     TEXT NULL,

        -- Status
        status          VARCHAR(20) NOT NULL DEFAULT 'pending',

        -- Raw data from email/whatsapp for traceability
        raw_payload     JSONB NULL,

        -- Full AI extraction result stored here
        ai_extracted    JSONB NULL,

        -- Optional link to a project
        project_id      UUID NULL REFERENCES projects(id) ON DELETE SET NULL,

        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

        CONSTRAINT CHK_INVOICES_SOURCE   CHECK (source   IN ('email', 'whatsapp', 'manual')),
        CONSTRAINT CHK_INVOICES_CATEGORY CHECK (category IN ('sale', 'cost', 'expense')),
        CONSTRAINT CHK_INVOICES_STATUS   CHECK (status   IN ('pending', 'confirmed', 'rejected'))
      );
    `);

    await queryRunner.query(`CREATE INDEX IDX_INVOICES_CLIENT   ON invoices(client_id);`);
    await queryRunner.query(`CREATE INDEX IDX_INVOICES_SOURCE   ON invoices(source);`);
    await queryRunner.query(`CREATE INDEX IDX_INVOICES_CATEGORY ON invoices(category);`);
    await queryRunner.query(`CREATE INDEX IDX_INVOICES_DATE     ON invoices(invoice_date);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_INVOICES_DATE;`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_INVOICES_CATEGORY;`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_INVOICES_SOURCE;`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_INVOICES_CLIENT;`);
    await queryRunner.query(`DROP TABLE IF EXISTS invoices;`);
  }
}
