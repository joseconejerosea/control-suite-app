import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClients1700000000010 implements MigrationInterface {
  name = 'CreateClients1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE clients (
        id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre                  VARCHAR(255)  NOT NULL,
        rut                     VARCHAR(20)   NULL,
        plan                    VARCHAR(50)   NOT NULL DEFAULT 'basic',
        status                  VARCHAR(30)   NOT NULL DEFAULT 'onboarding',
        onboarding_step         VARCHAR(30)   NOT NULL DEFAULT 'client_created',
        config                  JSONB         NULL,
        onboarding_completed_at TIMESTAMPTZ   NULL,
        created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_CLIENTS_STATUS ON clients(status)
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_CLIENTS_RUT ON clients(rut) WHERE rut IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_CLIENTS_RUT`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_CLIENTS_STATUS`);
    await queryRunner.query(`DROP TABLE IF EXISTS clients`);
  }
}
