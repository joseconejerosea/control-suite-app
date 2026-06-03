import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguageToUsers1700000000028 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN language VARCHAR(5) NOT NULL DEFAULT 'es'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN language`);
  }
}
