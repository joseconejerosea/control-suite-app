import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Destraba el INSERT de `promoters` (POST /api/promoters → 500).
 *
 * Síntoma: `GET /api/promoters` devolvía 200 pero `POST /api/promoters` daba 500.
 * Error real de Postgres:
 *   null value in column "name" of relation "promoters" violates not-null constraint
 *
 * Causa (drift del WRITE path): la tabla original (CreatePromoters #004) tenía una
 * columna `name` NOT NULL sin default. El entity evolucionó y partió ese campo en
 * `first_name` + `last_name` (reconciliados en el READ path por #056), pero la
 * columna vieja `name` quedó HUÉRFANA: sigue en la DB, NOT NULL, y ningún INSERT
 * la llena → toda alta de promotor rompe.
 *
 * #056 arregló las LECTURAS (ADD COLUMN IF NOT EXISTS) pero no vio que la columna
 * legacy NOT NULL mata las ESCRITURAS. Esta migración cierra ese hueco.
 *
 * Alcance: SOLO `promoters`. Verificado (empírico, dev) que campaigns/locations/
 * activations insertan 201 — sus columnas legacy NOT NULL (`name`, `campaign_id`)
 * siguen mapeadas en el entity y se llenan, así que NO son drift y no se tocan.
 *
 * Estrategia: idempotente y no-destructiva. Solo afloja el NOT NULL y backfillea
 * las filas existentes (si las hubiera) desde first_name/last_name para no dejar
 * la columna legacy en null.
 */
export class FixPromotersLegacyNameNotNull1700000000057 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Afloja el NOT NULL de la columna legacy (idempotente: DROP NOT NULL es no-op
    // si ya es nullable). El `IF EXISTS` sobre la columna evita romper si en algún
    // entorno la columna vieja ya fue eliminada.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'promoters' AND column_name = 'name'
        ) THEN
          ALTER TABLE "promoters" ALTER COLUMN "name" DROP NOT NULL;

          -- Backfill defensivo: si quedaron filas viejas con name null, lo derivamos
          -- de first_name/last_name (trim para no dejar espacios sueltos).
          UPDATE "promoters"
             SET "name" = NULLIF(TRIM(COALESCE("first_name", '') || ' ' || COALESCE("last_name", '')), '')
           WHERE "name" IS NULL;
        END IF;
      END $$
    `);
  }

  public async down(): Promise<void> {
    // No-op deliberado: re-imponer NOT NULL podría fallar si hay filas con name null
    // (el modelo actual ya no llena esa columna). No se revierte.
  }
}
