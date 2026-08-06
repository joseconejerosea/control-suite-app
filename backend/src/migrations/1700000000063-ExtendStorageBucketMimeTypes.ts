import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Alinea los MIME permitidos del bucket `control-suite` con lo que el upload de
 * project-inbox (y document-ingestion) YA aceptan a nivel controller.
 *
 * Síntoma (logs dev): subir un CSV o un PPTX a "Crear proyecto desde documento"
 * daba 500 "error inesperado":
 *   [StorageService] Upload failed [...csv]: mime type text/csv is not supported
 * El controller aceptaba el archivo (ALLOWED_MIME incluye csv/xls/doc/pptx/ppt) pero
 * Supabase lo rechazaba porque el `allowed_mime_types` del bucket (migración 035) NO
 * los tenía — solo pdf/xlsx/docx + imágenes/audio/video. Triple inconsistencia:
 * el modal promete "PPT", el controller lo acepta, el bucket lo rechaza.
 *
 * Idempotente: setea la lista completa deseada (no hace append). El `storage.buckets`
 * es de Supabase; el rol de migración ya escribe ahí (la 035 insertó el bucket).
 */
export class ExtendStorageBucketMimeTypes1700000000063
  implements MigrationInterface
{
  name = 'ExtendStorageBucketMimeTypes1700000000063';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE storage.buckets
         SET allowed_mime_types = ARRAY[
           'image/jpeg', 'image/png', 'image/webp', 'image/heic',
           'application/pdf',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        -- .xlsx
           'application/vnd.ms-excel',                                                 -- .xls
           'text/csv',                                                                 -- .csv
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  -- .docx
           'application/msword',                                                       -- .doc
           'application/vnd.openxmlformats-officedocument.presentationml.presentation',-- .pptx
           'application/vnd.ms-powerpoint',                                            -- .ppt
           'audio/ogg', 'audio/mpeg', 'audio/mp4',
           'video/mp4', 'video/quicktime', 'video/x-msvideo'
         ]::text[]
       WHERE id = 'control-suite'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Revertir a la lista original de la migración 035.
    await q.query(`
      UPDATE storage.buckets
         SET allowed_mime_types = ARRAY[
           'image/jpeg', 'image/png', 'image/webp', 'image/heic',
           'application/pdf',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'audio/ogg', 'audio/mpeg', 'audio/mp4',
           'video/mp4', 'video/quicktime'
         ]::text[]
       WHERE id = 'control-suite'
    `);
  }
}
