import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F4 Tier 2 · Fase 3 (CICLO DE VIDA) — marca de cierre de la ronda de convocatoria.
 *
 * convocatoria_cerrada_at se setea UNA sola vez, cuando todas las convocatorias
 * del proyecto quedan resueltas (ninguna en 'enviada'/'pendiente'). Sirve de guard
 * idempotente para notificar al operador exactamente una vez (CLOSED).
 */
export class AddConvocatoriaCerradaAtToProjects1700000000048 implements MigrationInterface {
  name = 'AddConvocatoriaCerradaAtToProjects1700000000048';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS convocatoria_cerrada_at TIMESTAMPTZ`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE projects DROP COLUMN IF EXISTS convocatoria_cerrada_at`);
  }
}
