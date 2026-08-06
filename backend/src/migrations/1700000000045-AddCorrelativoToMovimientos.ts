import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCorrelativoToMovimientos1700000000045 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE movimientos_pop ADD COLUMN IF NOT EXISTS correlativo INTEGER`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE movimientos_pop DROP COLUMN IF EXISTS correlativo`,
    );
  }
}
