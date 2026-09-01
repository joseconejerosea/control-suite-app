import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F3 (Matriz v1.4) — Añade `created_by_user_id` a movimientos_pop para registrar QUIÉN
 * REGISTRÓ el movimiento desde el panel (auditoría), SEPARADO de `persona_id` (el
 * field-person que alimenta las devoluciones de stock).
 *
 * CONTEXTO:
 *  Los movimientos del panel guardaban responsable=null. Setear persona_id=user.sub habría
 *  contaminado las devoluciones (stock-returns.service filtra por persona_id → le habría
 *  disparado pedidos de devolución al manager). Por eso la auditoría va en una columna aparte.
 *
 * ESTRATEGIA:
 *  - Columna UUID NULL: las filas existentes quedan sin registrar (no rompe ningún INSERT).
 *  - IF NOT EXISTS: idempotente ante un re-run parcial.
 *  - Número 076 (no 075): 075 lo usa la rama de los bloqueadores ALTA; se evita la colisión.
 *
 * down(): DROP COLUMN reversible.
 */
export class AddCreatedByUserIdMovimientos1700000000076 implements MigrationInterface {
  name = 'AddCreatedByUserIdMovimientos1700000000076';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE movimientos_pop
        ADD COLUMN IF NOT EXISTS created_by_user_id UUID NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE movimientos_pop
        DROP COLUMN IF EXISTS created_by_user_id
    `);
  }
}
