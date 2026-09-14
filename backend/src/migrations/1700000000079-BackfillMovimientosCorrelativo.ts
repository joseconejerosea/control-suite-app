import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P19 (Informe v1.9) — Backfill del `correlativo` en movimientos_pop.
 *
 * CONTEXTO:
 *  El `correlativo` es una secuencia por (client_id, sku_id). Se agregó después de que ya
 *  existían movimientos, y la auto-merma (calcularMermaProyecto) era la única INSERT que no
 *  lo calculaba (ya corregido en código). Resultado en dev: 53 filas con correlativo NULL
 *  (entradas/salidas/devoluciones históricas + 2 auto-mermas) → la secuencia por SKU quedaba
 *  con huecos. El informe pide "correlativo de la merma automática con evidencia"; como el
 *  hueco es transversal (no solo mermas), backfilleamos TODAS las filas NULL para que cada
 *  secuencia (client_id, sku_id) quede completa.
 *
 * ESTRATEGIA:
 *  A cada fila con correlativo NULL le asignamos MAX(correlativo existente de su grupo) +
 *  un incremento por orden cronológico (created_at, id) DENTRO del grupo. Así:
 *   - Nunca colisiona con un correlativo ya asignado (todos ≤ MAX).
 *   - Grupos 100% NULL arrancan en 1 (COALESCE(MAX,0)).
 *   - Idempotente: WHERE correlativo IS NULL → un re-run no toca nada ya backfilleado.
 *
 * down(): NO reversible — una vez asignado el correlativo es dato real y se pierde la
 *  información de "cuáles eran NULL". No-op intencional (patrón de las migraciones de backfill).
 */
export class BackfillMovimientosCorrelativo1700000000079
  implements MigrationInterface
{
  name = 'BackfillMovimientosCorrelativo1700000000079';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      WITH ranked AS (
        SELECT m.id,
               COALESCE(base.max_corr, 0)
                 + ROW_NUMBER() OVER (
                     PARTITION BY m.client_id, m.sku_id
                     ORDER BY m.created_at, m.id
                   ) AS new_corr
          FROM movimientos_pop m
          JOIN LATERAL (
            SELECT MAX(m2.correlativo) AS max_corr
              FROM movimientos_pop m2
             WHERE m2.client_id = m.client_id
               AND m2.sku_id    = m.sku_id
          ) base ON true
         WHERE m.correlativo IS NULL
      )
      UPDATE movimientos_pop t
         SET correlativo = r.new_corr
        FROM ranked r
       WHERE t.id = r.id
    `);
  }

  public async down(): Promise<void> {
    // Backfill no reversible: los correlativos asignados son dato real. No-op.
  }
}
