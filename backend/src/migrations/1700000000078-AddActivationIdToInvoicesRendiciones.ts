import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * C2 (Informe v1.9) — Amarra gastos/rendiciones a un registro REAL de Activación.
 *
 * PROBLEMA (silo):
 *  invoices y rendiciones sólo tenían `project_id`. Todo el terreno/F5 (checkins,
 *  montaje_evidencias, incidencias, reportes_avance, reportes_cliente) cuelga de
 *  `activacion_id`. Por eso un gasto caía bajo un "proyecto" con nombre tipo activación
 *  pero NO existía como registro operativo, y el reporte D+1 (F5) nunca veía ese gasto:
 *  gasto y terreno vivían en silos que no compartían la entidad Activación.
 *
 * SOLUCIÓN:
 *  Columna `activation_id` (UUID NULL, FK ON DELETE SET NULL) en invoices y rendiciones.
 *  Nullable a propósito: el bot la infiere por promotor + fecha; si hay 0 o >1 activación
 *  candidata queda null (el gasto sigue agrupado por proyecto, como hoy) y el panel la
 *  reasigna a mano. ON DELETE SET NULL: borrar una activación no borra el gasto histórico.
 *
 * ÍNDICE: tenant-first (client_id, activation_id) para el JOIN del reporte F5 y las
 * consultas de rendición por activación.
 *
 * down(): DROP reversible. Los gastos pierden sólo el vínculo a la activación.
 */
export class AddActivationIdToInvoicesRendiciones1700000000078
  implements MigrationInterface
{
  name = 'AddActivationIdToInvoicesRendiciones1700000000078';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS activation_id UUID NULL
          REFERENCES activations(id) ON DELETE SET NULL
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_activation
        ON invoices (client_id, activation_id)
    `);

    await q.query(`
      ALTER TABLE rendiciones
        ADD COLUMN IF NOT EXISTS activation_id UUID NULL
          REFERENCES activations(id) ON DELETE SET NULL
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS idx_rendiciones_activation
        ON rendiciones (client_id, activation_id)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_rendiciones_activation`);
    await q.query(`ALTER TABLE rendiciones DROP COLUMN IF EXISTS activation_id`);
    await q.query(`DROP INDEX IF EXISTS idx_invoices_activation`);
    await q.query(`ALTER TABLE invoices DROP COLUMN IF EXISTS activation_id`);
  }
}
