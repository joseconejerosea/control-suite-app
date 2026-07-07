import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles Model · feedback del cliente por email → NOVEDAD.
 *
 * Para poder matchear la respuesta del cliente con el reporte que se le envió,
 * guardamos el identificador del correo de reporte enviado. Resend soporta un
 * header `Message-ID` custom en el request y devuelve además su propio `id`.
 * Generamos NOSOTROS un Message-ID RFC-compliant, lo mandamos como header y lo
 * persistimos acá; cuando el cliente responde, su correo trae ese valor en
 * `In-Reply-To` / `References`, y así lo ligamos de vuelta al reporte.
 *
 * ⚠️ Si el proveedor no respetara el header custom, el matching por threading
 * degrada al fallback por remitente (email del `from` ∈ report_recipients del
 * proyecto). Ver GmailService.pollInbox.
 */
export class AddEmailMessageIdToReportesCliente1700000000052 implements MigrationInterface {
  name = 'AddEmailMessageIdToReportesCliente1700000000052';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE reportes_cliente
        ADD COLUMN IF NOT EXISTS email_message_id VARCHAR(255)
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_reportes_cliente_email_message_id
        ON reportes_cliente(email_message_id)
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_reportes_cliente_email_message_id`);
    await qr.query(`ALTER TABLE reportes_cliente DROP COLUMN IF EXISTS email_message_id`);
  }
}
