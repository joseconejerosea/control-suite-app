import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F4 Tier 2 · Fase 1 (FUNDACIONES) — constraint único de turno.
 *
 * convocatorias no tenía UNIQUE sobre (client_id, proyecto_id, persona_id, dia),
 * así que el `ON CONFLICT DO NOTHING` de asignarTurnos (projects.service) era
 * inerte: cada re-asignación insertaba una convocatoria duplicada para la misma
 * persona/día. Este índice hace que el ON CONFLICT realmente deduplique.
 *
 * Antes de crear el índice se limpian los duplicados existentes conservando, por
 * grupo, la fila más avanzada (con respuesta > enviada > la más antigua).
 */
export class UniqueConvocatoriaTurno1700000000047 implements MigrationInterface {
  name = 'UniqueConvocatoriaTurno1700000000047';

  async up(qr: QueryRunner): Promise<void> {
    // Dedupe: conservar la fila con más progreso por (client, proyecto, persona, dia).
    await qr.query(`
      DELETE FROM convocatorias c
      USING (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY client_id, proyecto_id, persona_id, dia
            ORDER BY (respuesta_at IS NOT NULL) DESC,
                     mensaje_enviado_at DESC NULLS LAST,
                     created_at ASC
          ) AS rn
        FROM convocatorias
      ) d
      WHERE c.id = d.id AND d.rn > 1
    `);

    await qr.query(`
      CREATE UNIQUE INDEX uq_convocatorias_turno
        ON convocatorias(client_id, proyecto_id, persona_id, dia)
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS uq_convocatorias_turno`);
  }
}
