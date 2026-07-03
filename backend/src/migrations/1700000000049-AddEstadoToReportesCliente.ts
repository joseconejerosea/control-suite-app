import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F5 · Fase 1 (FUNDACIONES) — estado explícito del reporte al cliente.
 *
 * Hoy el "estado" del reporte era implícito en los timestamps (aprobado_at,
 * enviado_at), y el report.processor los seteaba al generar → auto-aprobación
 * (viola el gate humano, mismo invariante que F2). Este estado explícito ordena
 * la máquina: borrador → aprobado → enviado, y es la base sobre la que la Fase 2
 * enforcea el gate server-side.
 *
 * Backfill de filas existentes: se derivan del timestamp más avanzado presente.
 */
export class AddEstadoToReportesCliente1700000000049 implements MigrationInterface {
  name = 'AddEstadoToReportesCliente1700000000049';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE reportes_cliente
         ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'borrador'`,
    );

    // Backfill: el estado se deriva del progreso ya registrado en los timestamps.
    await qr.query(`
      UPDATE reportes_cliente
         SET estado = CASE
           WHEN enviado_at   IS NOT NULL THEN 'enviado'
           WHEN aprobado_at  IS NOT NULL THEN 'aprobado'
           ELSE 'borrador'
         END
    `);

    await qr.query(
      `CREATE INDEX IF NOT EXISTS idx_reportes_cliente_estado
         ON reportes_cliente(client_id, activacion_id, estado)`,
    );
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_reportes_cliente_estado`);
    await qr.query(`ALTER TABLE reportes_cliente DROP COLUMN IF EXISTS estado`);
  }
}
