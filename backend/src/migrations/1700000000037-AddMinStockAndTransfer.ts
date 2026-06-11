import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMinStockAndTransfer1700000000037 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE skus ADD COLUMN IF NOT EXISTS min_stock INTEGER DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE movimientos_pop ADD COLUMN IF NOT EXISTS bodega_destino_id UUID REFERENCES bodegas(id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE movimientos_pop DROP COLUMN IF EXISTS bodega_destino_id`);
    await queryRunner.query(`ALTER TABLE skus DROP COLUMN IF EXISTS min_stock`);
  }
}
