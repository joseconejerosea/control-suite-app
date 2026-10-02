import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega rol_tipo (enum DB-enforced) y rota (boolean) a la tabla promoters.
 *
 * AUDITORÍA PRE-BACKFILL (B6-T01):
 *   Ejecutado: SELECT DISTINCT lower(rol) FROM promoters WHERE rol IS NOT NULL ORDER BY 1;
 *   Resultado: solo 'promotor' (1 fila). Mapa de normalización cubre el único valor real.
 *   Valores desconocidos → rol_tipo=NULL, rota=true (conservador per I-1).
 *
 * La columna legacy `rol` VARCHAR(100) se mantiene intacta para compatibilidad.
 */
export class AddRolTipoAndRotaToPromoters1700000000072
  implements MigrationInterface
{
  name = 'AddRolTipoAndRotaToPromoters1700000000072';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Crear tipo enum postgres
    await q.query(`
      CREATE TYPE promotor_rol_tipo_enum AS ENUM (
        'promotor',
        'anfitrion',
        'productor',
        'supervisor',
        'coordinador',
        'brand_manager',
        'observer'
      )
    `);

    // 2. Agregar columna rol_tipo (nullable inicialmente para el backfill)
    await q.query(`
      ALTER TABLE promoters
        ADD COLUMN IF NOT EXISTS rol_tipo promotor_rol_tipo_enum
    `);

    // 3. Agregar columna rota (nullable inicialmente, se fija después del backfill)
    await q.query(`
      ALTER TABLE promoters
        ADD COLUMN IF NOT EXISTS rota BOOLEAN
    `);

    // 4. Backfill rol_tipo desde el texto libre de rol (case-insensitive, stems)
    //    Stems usados: 'promotor', 'anfitri' (cubre anfitriona/anfitrión),
    //    'productor', 'supervisor', 'coordinad', 'brand' (cubre "brand manager").
    await q.query(`
      UPDATE promoters
         SET rol_tipo = (CASE
           WHEN lower(rol) ~ 'promotor'   THEN 'promotor'
           WHEN lower(rol) ~ 'anfitri'    THEN 'anfitrion'
           WHEN lower(rol) ~ 'productor'  THEN 'productor'
           WHEN lower(rol) ~ 'supervisor' THEN 'supervisor'
           WHEN lower(rol) ~ 'coordinad'  THEN 'coordinador'
           WHEN lower(rol) ~ 'brand'      THEN 'brand_manager'
           ELSE NULL
         END)::promotor_rol_tipo_enum
       WHERE rol IS NOT NULL
    `);

    // 5. Backfill rota: roles no-rotativos → false; todo lo demás (incluido NULL) → true
    await q.query(`
      UPDATE promoters
         SET rota = CASE
           WHEN rol_tipo IN ('supervisor', 'coordinador', 'brand_manager', 'observer')
             THEN false
           ELSE true
         END
    `);

    // 6. Fijar DEFAULT true para que el overlap de deploy degrade a "preguntar agencia"
    //    en lugar de un NULL inesperado (JD-014).
    await q.query(`
      ALTER TABLE promoters
        ALTER COLUMN rota SET DEFAULT true
    `);

    // 7. Fijar NOT NULL después del backfill
    await q.query(`
      ALTER TABLE promoters
        ALTER COLUMN rota SET NOT NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE promoters DROP COLUMN IF EXISTS rota
    `);

    await q.query(`
      ALTER TABLE promoters DROP COLUMN IF EXISTS rol_tipo
    `);

    await q.query(`
      DROP TYPE IF EXISTS promotor_rol_tipo_enum
    `);
    // La columna legacy 'rol' no se toca.
  }
}
