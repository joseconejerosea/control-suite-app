import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles Model · Fase 2b — permite usuarios PLATFORM-LEVEL (client_id IS NULL).
 *
 * El SERVICE_LEAD no pertenece a ningún tenant fijo: elige la agencia activa al
 * loguear (ver AuthService.selectTenant). Por eso su fila en `users` debe tener
 * client_id = NULL hasta que selecciona un tenant (que sólo vive en el JWT, no
 * en la fila). Hoy `users.client_id` es NOT NULL (migración 000), lo que impide
 * crear un SL. Esta migración lo hace NULLABLE.
 *
 * ⚠️ RLS: `users` NO tiene RLS (excluida a propósito en 040 — el login busca por
 * email sin tenant). Por lo tanto una fila con client_id NULL es insertable y
 * legible sin restricción; NO hay policy que ajustar. El aislamiento de estos
 * usuarios lo dan ServiceLeadGuard (valida asignación por request) y los @Roles.
 *
 * La FK a clients (ON DELETE RESTRICT) sigue vigente: una FK sobre columna
 * nullable simplemente no valida cuando el valor es NULL, así que no hace falta
 * tocarla.
 */
export class MakeUsersClientIdNullable1700000000053 implements MigrationInterface {
  name = 'MakeUsersClientIdNullable1700000000053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ALTER COLUMN client_id DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible sólo si no existen filas platform-level. Si las hay, fallará
    // (intencional: no se puede volver al invariante NOT NULL con SLs vivos).
    await queryRunner.query(`ALTER TABLE users ALTER COLUMN client_id SET NOT NULL`);
  }
}
