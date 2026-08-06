import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectInbox1700000000034 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE project_inbox (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL,
        source          VARCHAR(20) NOT NULL,
        raw_content     JSONB NOT NULL,
        extracted_data  JSONB,
        conflicts       JSONB,
        missing_fields  JSONB,
        status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        project_id      UUID,
        reviewed_by     UUID,
        reviewed_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_project_inbox_tenant ON project_inbox(tenant_id)`);
    await queryRunner.query(
      `COMMENT ON COLUMN project_inbox.source IS 'EMAIL | UPLOAD | WHATSAPP'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN project_inbox.status IS 'PENDING | PROCESSING | READY | APPROVED | REJECTED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS project_inbox CASCADE`);
  }
}
