import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec §06 F4: tablas para setup de proyectos/activaciones
 * proyecto_equipo — personas asignadas a cada proyecto (usado por F2 para agrupación)
 * convocatorias   — sistema de convocatoria por WhatsApp (F4 scheduler)
 */
export class CreateProyectoEquipo1700000000023 implements MigrationInterface {
  name = 'CreateProyectoEquipo1700000000023';

  async up(qr: QueryRunner): Promise<void> {
    /* ── proyecto_equipo ─────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE proyecto_equipo (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id          UUID NOT NULL,
        proyecto_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        persona_id         UUID NOT NULL,
        rol                VARCHAR(100) NOT NULL DEFAULT 'Promotor',
        costo_dia          DECIMAL(10,2),
        dias_asignados     INTEGER,
        confirmado_at      TIMESTAMPTZ,
        fecha_inicio       DATE,
        fecha_fin          DATE,
        activo             BOOLEAN NOT NULL DEFAULT true,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_proyecto_equipo UNIQUE (client_id, proyecto_id, persona_id)
      )
    `);
    await qr.query(`CREATE INDEX idx_proyecto_equipo_client ON proyecto_equipo(client_id, proyecto_id)`);
    await qr.query(`CREATE INDEX idx_proyecto_equipo_persona ON proyecto_equipo(client_id, persona_id, activo)`);

    /* ── convocatorias ───────────────────────────────────────────────────── */
    await qr.query(`
      CREATE TABLE convocatorias (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id             UUID NOT NULL,
        proyecto_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        persona_id            UUID NOT NULL,
        dia                   DATE NOT NULL,
        local_nombre          VARCHAR(255),
        local_direccion       TEXT,
        mensaje_enviado_at    TIMESTAMPTZ,
        respuesta_texto       TEXT,
        respuesta_at          TIMESTAMPTZ,
        estado                VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        reenvio_count         INTEGER NOT NULL DEFAULT 0,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_convocatorias_proyecto ON convocatorias(client_id, proyecto_id, dia)`);
    await qr.query(`CREATE INDEX idx_convocatorias_persona ON convocatorias(client_id, persona_id, estado)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS convocatorias CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS proyecto_equipo CASCADE`);
  }
}
