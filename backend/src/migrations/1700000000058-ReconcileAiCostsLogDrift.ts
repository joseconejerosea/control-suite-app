import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconcilia el drift de `ai_costs_log` (write + read path del logging de costo IA).
 *
 * Síntoma (logs F1): `column "flow" of relation "ai_costs_log" does not exist` al
 * insertar el costo del OCR → WARN silencioso, la Auditoría AI queda sin el gasto de F1.
 *
 * Causa: la tabla (CreateMind #022) se creó con `ts` como columna de tiempo y SIN
 * `flow`/`description`, pero el código evolucionó por otro lado:
 *   - INSERT (ocr.processor) mete `flow` + `description`.
 *   - Lectores (audit/monitoring/cron) filtran por `created_at` y agrupan por `flow`.
 * Ninguna de esas columnas existía → los inserts fallan y los reads devuelven vacío
 * (enmascarado por `.catch(() => [])`).
 *
 * Estrategia: idempotente y no-destructiva (`ADD COLUMN IF NOT EXISTS`). Se agrega
 * `created_at` (lo que el código espera) y se backfillea desde `ts`. NO se toca `ts`
 * ni su índice/RLS.
 */
export class ReconcileAiCostsLogDrift1700000000058 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_costs_log"
        ADD COLUMN IF NOT EXISTS "flow"        varchar(50),
        ADD COLUMN IF NOT EXISTS "description" text,
        ADD COLUMN IF NOT EXISTS "created_at"  timestamptz DEFAULT now()
    `);
    // Backfill: las filas viejas solo tenían `ts`. Alinear created_at con ts.
    await queryRunner.query(`
      UPDATE "ai_costs_log" SET "created_at" = "ts" WHERE "created_at" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // No-op: reconciliación no-destructiva (ADD IF NOT EXISTS). No se revierte para
    // no borrar columnas/datos legítimos.
  }
}
