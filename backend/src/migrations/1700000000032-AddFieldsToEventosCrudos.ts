import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFieldsToEventosCrudos1700000000032 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE eventos_crudos ADD COLUMN flow VARCHAR(10) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE eventos_crudos ADD COLUMN parsed_data JSONB NULL`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN eventos_crudos.flow IS 'F1 | F2 | F3 | F4 | F5'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN eventos_crudos.parsed_data IS 'Proyecto inferido, metodo de inferencia, nivel de confianza'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE eventos_crudos DROP COLUMN parsed_data`);
    await queryRunner.query(`ALTER TABLE eventos_crudos DROP COLUMN flow`);
  }
}
