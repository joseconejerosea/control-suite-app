import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCollaborators1700000000014 implements MigrationInterface {
  name = 'CreateCollaborators1700000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE collaborators (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        project_id      UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
        full_name       VARCHAR(255) NOT NULL,
        email           VARCHAR(255) NULL,
        phone           VARCHAR(20) NULL,
        role_label      VARCHAR(100) NOT NULL DEFAULT 'observer',
        is_active       BOOLEAN NOT NULL DEFAULT true,
        config          JSONB NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT CHK_COLLABORATORS_ROLE CHECK (role_label IN ('observer','supervisor','coordinator','brand_manager'))
      );
    `);

    await queryRunner.query(`CREATE INDEX IDX_COLLABORATORS_CLIENT ON collaborators(client_id);`);
    await queryRunner.query(`CREATE INDEX IDX_COLLABORATORS_PROJECT ON collaborators(project_id);`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IDX_COLLABORATORS_CLIENT_EMAIL
      ON collaborators(client_id, email)
      WHERE email IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_COLLABORATORS_CLIENT_EMAIL;`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_COLLABORATORS_PROJECT;`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_COLLABORATORS_CLIENT;`);
    await queryRunner.query(`DROP TABLE IF EXISTS collaborators;`);
  }
}
