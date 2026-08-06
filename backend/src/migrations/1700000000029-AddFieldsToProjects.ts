import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFieldsToProjects1700000000029 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE projects ADD COLUMN objectives TEXT NULL`);
    await queryRunner.query(`ALTER TABLE projects ADD COLUMN kpis JSONB NULL`);
    await queryRunner.query(`ALTER TABLE projects ADD COLUMN staff_requirements JSONB NULL`);
    await queryRunner.query(`ALTER TABLE projects ADD COLUMN pop_required JSONB NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE projects DROP COLUMN pop_required`);
    await queryRunner.query(`ALTER TABLE projects DROP COLUMN staff_requirements`);
    await queryRunner.query(`ALTER TABLE projects DROP COLUMN kpis`);
    await queryRunner.query(`ALTER TABLE projects DROP COLUMN objectives`);
  }
}
