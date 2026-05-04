import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientFK1700000000011 implements MigrationInterface {
  name = 'AddClientFK1700000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT FK_USERS_CLIENT
        FOREIGN KEY (client_id)
        REFERENCES clients(id)
        ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE canal_entrada
        ADD CONSTRAINT FK_CANAL_ENTRADA_CLIENT
        FOREIGN KEY (client_id)
        REFERENCES clients(id)
        ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE canal_entrada DROP CONSTRAINT IF EXISTS FK_CANAL_ENTRADA_CLIENT
    `);
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS FK_USERS_CLIENT
    `);
  }
}
