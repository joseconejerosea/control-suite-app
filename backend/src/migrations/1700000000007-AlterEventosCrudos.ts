import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterEventosCrudos1700000000007 implements MigrationInterface {
  name = 'AlterEventosCrudos1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    
    await queryRunner.query(`
      ALTER TABLE "eventos_crudos"
        ADD COLUMN IF NOT EXISTS "status"          VARCHAR(20)  NOT NULL DEFAULT 'received',
        ADD COLUMN IF NOT EXISTS "error_message"   TEXT         NULL,
        ADD COLUMN IF NOT EXISTS "queued_at"       TIMESTAMPTZ  NULL,
        ADD COLUMN IF NOT EXISTS "processed_at"    TIMESTAMPTZ  NULL,
        ADD COLUMN IF NOT EXISTS "job_id"          VARCHAR      NULL,
        ADD COLUMN IF NOT EXISTS "attempts"        INTEGER      NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR      NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "eventos_crudos"
        ALTER COLUMN "client_id" DROP NOT NULL
    `);

   
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_EVENTOS_CRUDOS_STATUS"
        ON "eventos_crudos" ("status")
    `);

    
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_EVENTOS_CRUDOS_IDEMPOTENCY"
        ON "eventos_crudos" ("idempotency_key")
        WHERE "idempotency_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_EVENTOS_CRUDOS_IDEMPOTENCY"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_EVENTOS_CRUDOS_STATUS"`);

    await queryRunner.query(`
      ALTER TABLE "eventos_crudos"
        ALTER COLUMN "client_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "eventos_crudos"
        DROP COLUMN IF EXISTS "idempotency_key",
        DROP COLUMN IF EXISTS "attempts",
        DROP COLUMN IF EXISTS "job_id",
        DROP COLUMN IF EXISTS "processed_at",
        DROP COLUMN IF EXISTS "queued_at",
        DROP COLUMN IF EXISTS "error_message",
        DROP COLUMN IF EXISTS "status"
    `);
  }
}
