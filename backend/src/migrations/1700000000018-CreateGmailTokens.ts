import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGmailTokens1700000000018 implements MigrationInterface {
  name = 'CreateGmailTokens1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE gmail_tokens (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email      VARCHAR(255) NOT NULL UNIQUE,
        tokens     JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS gmail_tokens;`);
  }
}
