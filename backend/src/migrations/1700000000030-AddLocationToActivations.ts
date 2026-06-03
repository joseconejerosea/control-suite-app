import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLocationToActivations1700000000030 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE activations ADD COLUMN location JSONB NULL`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN activations.location IS '{ address: string, lat: number, lng: number, radiusMeters: number }'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE activations DROP COLUMN location`);
  }
}
