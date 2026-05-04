import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectFK1700000000015 implements MigrationInterface {
  name = 'AddProjectFK1700000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE campaigns
      ADD COLUMN project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(`CREATE INDEX IDX_CAMPAIGNS_PROJECT ON campaigns(project_id);`);

    await queryRunner.query(`
      ALTER TABLE activations
      ADD COLUMN project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(`CREATE INDEX IDX_ACTIVATIONS_PROJECT ON activations(project_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_ACTIVATIONS_PROJECT;`);
    await queryRunner.query(`ALTER TABLE activations DROP COLUMN IF EXISTS project_id;`);

    await queryRunner.query(`DROP INDEX IF EXISTS IDX_CAMPAIGNS_PROJECT;`);
    await queryRunner.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS project_id;`);
  }
}
