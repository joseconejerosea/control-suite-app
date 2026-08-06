import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles Model · Fase 2b — email único para usuarios PLATFORM-LEVEL (SERVICE_LEAD).
 *
 * El índice único de `users` es compuesto `(client_id, email)` (migración 009),
 * lo que da unicidad POR tenant: el mismo email puede existir en dos agencias.
 * Pero para los SL, client_id es NULL — y en SQL `NULL <> NULL`, así que el
 * índice compuesto trata a `(NULL, x@y.com)` y `(NULL, x@y.com)` como distintos
 * y NO impide duplicados. Hoy eso lo cubre validación a nivel app en
 * AdminServiceLeadsController.create(), que tiene una carrera (check-then-insert).
 *
 * Este índice único PARCIAL mueve la garantía a la base: entre las filas
 * platform-level (client_id IS NULL) el email debe ser único. Los usuarios de
 * tenant siguen gobernados por el índice compuesto (no se ven afectados).
 */
export class AddPlatformUserEmailUniqueIndex1700000000054 implements MigrationInterface {
  name = 'AddPlatformUserEmailUniqueIndex1700000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_USERS_EMAIL_PLATFORM"
         ON users (email)
         WHERE client_id IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_USERS_EMAIL_PLATFORM"`);
  }
}
