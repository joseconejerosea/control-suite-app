import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 8 (Matriz v1.4) — Añade `posible_duplicado` (BOOLEAN NOT NULL DEFAULT false)
 * a la tabla invoices para el SOFT-FLAG de posible doble-conteo de boletas.
 *
 * CONTEXTO:
 *  El dedup de persist.processor tiene 2 capas (content-hash + natural-key) y ambas
 *  dependen de una llave que puede faltar (doc_sha256 NULL / OCR sin folio+RUT). Cuando
 *  faltan las dos, un reenvío de la MISMA boleta escapa la dedup y se cuenta doble.
 *  La tercera capa (soft) detecta un probable duplicado por vendor_name + amount +
 *  invoice_date y MARCA la factura (posible_duplicado=true) SIN borrarla; el reporte la
 *  excluye del total pero la sigue mostrando para que el humano confirme.
 *
 * ESTRATEGIA:
 *  - Columna NOT NULL con DEFAULT false: las filas existentes quedan sin marcar,
 *    y ningún INSERT previo se rompe (el default cubre a quien no la setee).
 *  - IF NOT EXISTS: idempotente ante un re-run parcial.
 *
 * down(): DROP COLUMN reversible. Las facturas ya marcadas pierden solo la marca.
 */
export class AddPosibleDuplicadoInvoices1700000000075 implements MigrationInterface {
  name = 'AddPosibleDuplicadoInvoices1700000000075';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS posible_duplicado BOOLEAN NOT NULL DEFAULT false
    `);
    // R1-002 · El soft-check corre un SELECT por vendor_name+amount+invoice_date en CADA
    // ingesta de factura; sin índice es un seq-scan que, dentro de la tx del tenant, puede
    // frenar el worker de BullMQ bajo carga. Índice compuesto tenant-first para cubrirlo.
    await q.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_softdup
        ON invoices (client_id, vendor_name, amount, invoice_date)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_invoices_softdup`);
    await q.query(`
      ALTER TABLE invoices
        DROP COLUMN IF EXISTS posible_duplicado
    `);
  }
}
