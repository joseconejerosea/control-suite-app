import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P1 (Matriz v1.5) — Backfill del soft-flag `posible_duplicado` sobre facturas
 * históricas.
 *
 * CONTEXTO:
 *  La tercera capa de dedup (soft-flag por vendor+monto+fecha, migración 075 +
 *  persist.processor Tarea 8) se agregó el 01-09-2026. El flag se calcula UNA sola vez,
 *  en el momento del INSERT. Toda factura ingresada ANTES de ese código quedó con
 *  posible_duplicado=false aunque fuera un duplicado — y el reporte de Gastos la sigue
 *  sumando al total. El QA v1.5 (P1) lo confirmó: dos boletas idénticas de "I.
 *  MUNICIPALIDAD DE VALPARAÍSO" (28-08) inflaban el total a $6.300.
 *
 * ESTRATEGIA:
 *  Se aplica la MISMA regla que la ingesta usa hoy, retroactivamente:
 *   - agrupar por (client_id, vendor_name, amount, invoice_date);
 *   - conservar SIN marcar la más antigua de cada grupo (rn=1, la "real");
 *   - marcar posible_duplicado=true las repetidas (rn>1) que hoy están en false.
 *  Mismos guards que persist.processor: vendor real (no 'Unknown') y amount > 0, para
 *  no colisionar dos proveedores sin nombre ni el fallback monto 0. Es un flag SOFT: la
 *  fila sigue visible en el reporte y sólo se excluye del total, para que el humano
 *  confirme (no se borra ningún gasto legítimo).
 *
 *  Idempotente: el `posible_duplicado = false` del WHERE evita re-tocar lo ya marcado.
 *
 * down(): revierte el mismo conjunto determinístico (rn>1 → false). Restaura el estado
 *  histórico exacto (al aplicar up, todas las rn>1 estaban en false). Nota: si la ingesta
 *  en vivo marcara una NUEVA repetida del mismo grupo después de este backfill, un revert
 *  también la desmarcaría — edge aceptable para un down que rara vez se corre en prod.
 */
export class BackfillPosibleDuplicadoInvoices1700000000077 implements MigrationInterface {
  name = 'BackfillPosibleDuplicadoInvoices1700000000077';

  public async up(q: QueryRunner): Promise<void> {
    // Backfill RETROACTIVO y GLOBAL (todos los tenants, toda la historia). A diferencia
    // del soft-check en vivo — que marca de a una en cada ingesta —, esto flaggea todo el
    // histórico de una. Se envuelve en un DO para emitir el conteo por RAISE NOTICE: el log
    // del deploy NO debe marcar en silencio (queda auditable cuántas facturas se excluyeron).
    await q.query(`
      DO $$
      DECLARE flagged integer;
      BEGIN
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY client_id, vendor_name, amount, invoice_date
                   ORDER BY created_at ASC, id ASC
                 ) AS rn
            FROM invoices
           WHERE vendor_name IS NOT NULL AND vendor_name <> 'Unknown' AND amount > 0
        )
        UPDATE invoices i
           SET posible_duplicado = true
          FROM ranked r
         WHERE i.id = r.id
           AND r.rn > 1
           AND i.posible_duplicado = false;
        GET DIAGNOSTICS flagged = ROW_COUNT;
        RAISE NOTICE 'BackfillPosibleDuplicadoInvoices: % facturas marcadas como posible_duplicado', flagged;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY client_id, vendor_name, amount, invoice_date
                 ORDER BY created_at ASC, id ASC
               ) AS rn
          FROM invoices
         WHERE vendor_name IS NOT NULL AND vendor_name <> 'Unknown' AND amount > 0
      )
      UPDATE invoices i
         SET posible_duplicado = false
        FROM ranked r
       WHERE i.id = r.id
         AND r.rn > 1
         AND i.posible_duplicado = true
    `);
  }
}
