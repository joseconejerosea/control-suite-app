import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFullNameToUsers1700000000027 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN full_name VARCHAR(100) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN full_name`);
  }
}
