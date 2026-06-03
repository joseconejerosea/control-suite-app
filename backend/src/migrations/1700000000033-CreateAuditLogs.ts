import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1700000000033 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID,
        user_id     UUID NOT NULL,
        action      VARCHAR(100) NOT NULL,
        entity      VARCHAR(100) NOT NULL,
        entity_id   VARCHAR(255) NOT NULL,
        metadata    JSONB,
        ip          VARCHAR(45),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_user ON audit_logs(user_id)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_entity ON audit_logs(entity, entity_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs CASCADE`);
  }
}
