import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjects1700000000013 implements MigrationInterface {
  name = 'CreateProjects1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE projects (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        name            VARCHAR(255) NOT NULL,
        description     TEXT NULL,
        status          VARCHAR(30) NOT NULL DEFAULT 'active',
        start_date      DATE NULL,
        end_date        DATE NULL,
        budget          DECIMAL(14,2) NULL,
        config          JSONB NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT CHK_PROJECTS_STATUS CHECK (status IN ('active','paused','archived'))
      );
    `);

    await queryRunner.query(`CREATE INDEX IDX_PROJECTS_CLIENT ON projects(client_id);`);
    await queryRunner.query(`CREATE INDEX IDX_PROJECTS_STATUS ON projects(status);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_PROJECTS_STATUS;`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_PROJECTS_CLIENT;`);
    await queryRunner.query(`DROP TABLE IF EXISTS projects;`);
  }
}
