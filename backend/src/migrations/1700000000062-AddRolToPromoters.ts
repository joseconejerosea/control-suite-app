import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F4 · convocatoria — rol/perfil del promotor (anfitrión) para la auto-sugerencia.
 *
 * La IA extrae `perfil_personas` con un `rol` (ej. "promotora", "anfitriona",
 * "supervisor"), pero `promoters` no tenía dónde guardar el rol del staff, así que
 * la sugerencia automática de convocatoria no podía filtrar por rol. Este campo
 * NULLABLE permite etiquetar cada promotor y matchearlo contra el perfil pedido.
 * Nullable a propósito: no rompe las filas existentes ni obliga a recargar staff.
 */
export class AddRolToPromoters1700000000062 implements MigrationInterface {
  name = 'AddRolToPromoters1700000000062';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE promoters ADD COLUMN IF NOT EXISTS rol VARCHAR(100)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE promoters DROP COLUMN IF EXISTS rol`);
  }
}
