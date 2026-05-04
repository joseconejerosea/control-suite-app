import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixUsersEmailIndex1700000000009 implements MigrationInterface {
  name = 'FixUsersEmailIndex1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Issue B FIX: Drop global unique constraint on email
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_users_email";
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_users_email";
    `);

    // Create composite unique index (client_id + email) — per-tenant uniqueness
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_USERS_CLIENT_EMAIL" ON "users" ("client_id", "email");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback: drop composite index
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_USERS_CLIENT_EMAIL";
    `);

    // Restore global unique constraint
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "UQ_users_email" UNIQUE ("email");
    `);
  }
}