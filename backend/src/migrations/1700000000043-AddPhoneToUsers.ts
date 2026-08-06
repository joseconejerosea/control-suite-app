import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhoneToUsers1700000000043 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN phone`);
  }
}
