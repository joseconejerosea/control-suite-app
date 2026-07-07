import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles Model · feedback del cliente por email → NOVEDAD.
 *
 * El feedback del cliente que llega por correo debe entrar al sistema como una
 * incidencia de la activación con su origen explícito. Hoy `incidencias` no tiene
 * columna que distinga de dónde nació la novedad (terreno/app, WhatsApp, email).
 *
 * `source` marca el canal de origen:
 *   MANUAL   — creada por un usuario (checkin/incidencia de terreno vía app).
 *   WHATSAPP — nacida de un evento de WhatsApp.
 *   EMAIL    — feedback del cliente que llegó por correo (respuesta al reporte).
 *   APP      — reservado.
 *
 * ⚠️ BACKFILL: se setea 'WHATSAPP' a las filas con raw_event_id NOT NULL como
 * heurística de origen. En la práctica NINGÚN path de código escribe hoy
 * raw_event_id en incidencias, así que este UPDATE probablemente no toque filas.
 * El resto queda 'MANUAL' (default), que es correcto para las incidencias de
 * terreno creadas por el F5Controller.
 */
export class AddSourceToIncidencias1700000000051 implements MigrationInterface {
  name = 'AddSourceToIncidencias1700000000051';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE incidencias
        ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
    `);

    await qr.query(`
      ALTER TABLE incidencias
        ADD CONSTRAINT chk_incidencias_source
        CHECK (source IN ('WHATSAPP','EMAIL','MANUAL','APP'))
    `);

    // Backfill heurístico: raw_event_id presente ⇒ probablemente vino de WhatsApp.
    // (Ver cabecera: hoy ningún path escribe raw_event_id, así que suele ser no-op.)
    await qr.query(`
      UPDATE incidencias
         SET source = 'WHATSAPP'
       WHERE raw_event_id IS NOT NULL
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE incidencias DROP CONSTRAINT IF EXISTS chk_incidencias_source`);
    await qr.query(`ALTER TABLE incidencias DROP COLUMN IF EXISTS source`);
  }
}
