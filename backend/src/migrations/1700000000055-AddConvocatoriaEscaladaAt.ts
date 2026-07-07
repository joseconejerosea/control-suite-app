import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backlog · Ciclo de convocatoria (C4) — marca de escalado por no-respuesta.
 *
 * escalada_at se setea UNA sola vez, cuando una convocatoria en 'enviada' llega a
 * reenvio_count=2 (los 2 recordatorios) y el promotor sigue sin responder. Sirve de
 * guard idempotente para crear la tarea al OPERATOR (mind_propuesta + WhatsApp)
 * exactamente una vez, sin depender de abusar de reenvio_count como triple-estado.
 *
 * Nota: la columna `convocatorias.estado` es VARCHAR(20) SIN CHECK constraint (ver
 * migración 023), por eso el nuevo estado 'cancelada' (C1) NO requiere alterar ningún
 * constraint: los valores válidos se controlan a nivel app (@IsIn en el DTO +
 * CONVOCATORIA_ESTADOS). Esta migración sólo agrega la columna de idempotencia de C4.
 */
export class AddConvocatoriaEscaladaAt1700000000055 implements MigrationInterface {
  name = 'AddConvocatoriaEscaladaAt1700000000055';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS escalada_at TIMESTAMPTZ`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE convocatorias DROP COLUMN IF EXISTS escalada_at`);
  }
}
