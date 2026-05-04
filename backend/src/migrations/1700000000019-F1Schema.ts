import { MigrationInterface, QueryRunner } from 'typeorm';

export class F1Schema1700000000019 implements MigrationInterface {
  name = 'F1Schema1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enums
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE processing_status_f1 AS ENUM (
          'queued', 'processing', 'processed',
          'failed_ocr', 'failed_classification',
          'low_confidence', 'unauthorized_sender',
          'unclassified', 'duplicate', 'reprocessing', 'discarded'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE tipo_documento AS ENUM (
          'factura_recibida', 'factura_emitida', 'boleta',
          'nota_credito', 'nota_debito', 'orden_compra', 'comprobante'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE destino_reporte AS ENUM ('gastos', 'ventas', 'costos');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // Add new columns to existing eventos_crudos table
    await queryRunner.query(`
      ALTER TABLE eventos_crudos
        ADD COLUMN IF NOT EXISTS canal VARCHAR(20),
        ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(20),
        ADD COLUMN IF NOT EXISTS email_from VARCHAR(160),
        ADD COLUMN IF NOT EXISTS doc_key VARCHAR(500),
        ADD COLUMN IF NOT EXISTS doc_mime_type VARCHAR(80),
        ADD COLUMN IF NOT EXISTS doc_size_bytes BIGINT,
        ADD COLUMN IF NOT EXISTS doc_sha256 CHAR(64),
        ADD COLUMN IF NOT EXISTS ocr_text TEXT,
        ADD COLUMN IF NOT EXISTS ocr_engine VARCHAR(40),
        ADD COLUMN IF NOT EXISTS ocr_duration_ms INTEGER,
        ADD COLUMN IF NOT EXISTS ocr_attempted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ai_classification JSONB,
        ADD COLUMN IF NOT EXISTS ai_model VARCHAR(40),
        ADD COLUMN IF NOT EXISTS ai_input_tokens INTEGER,
        ADD COLUMN IF NOT EXISTS ai_output_tokens INTEGER,
        ADD COLUMN IF NOT EXISTS ai_attempted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2),
        ADD COLUMN IF NOT EXISTS processing_status_new processing_status_f1 DEFAULT 'queued',
        ADD COLUMN IF NOT EXISTS retries SMALLINT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS factura_id UUID,
        ADD COLUMN IF NOT EXISTS reprocessed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS discarded_reason TEXT;
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ec_doc_sha256 ON eventos_crudos (client_id, doc_sha256);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ec_confidence ON eventos_crudos (client_id, confidence_score);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ec_processing ON eventos_crudos (client_id, processing_status_new, created_at DESC);
    `);

    // Add columns to invoices table for F1 compatibility
    await queryRunner.query(`
      ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS raw_event_id UUID,
        ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2),
        ADD COLUMN IF NOT EXISTS tipo tipo_documento,
        ADD COLUMN IF NOT EXISTS destino destino_reporte,
        ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(60),
        ADD COLUMN IF NOT EXISTS rut_emisor VARCHAR(15),
        ADD COLUMN IF NOT EXISTS razon_social_emisor VARCHAR(200),
        ADD COLUMN IF NOT EXISTS monto_neto BIGINT,
        ADD COLUMN IF NOT EXISTS monto_iva BIGINT,
        ADD COLUMN IF NOT EXISTS monto_total BIGINT,
        ADD COLUMN IF NOT EXISTS fecha_emision DATE,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    `);

    // Create equivalencias_ocr_cc table (for AI category mapping)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS equivalencias_ocr_cc (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
        keyword VARCHAR(200) NOT NULL,
        categoria VARCHAR(60) NOT NULL,
        destino destino_reporte NOT NULL,
        confidence_boost DECIMAL(3,2) DEFAULT 0.10,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_equiv_client ON equivalencias_ocr_cc (client_id, categoria);
    `);

    // Create f1_reprocess_log table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS f1_reprocess_log (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        evento_crudo_id UUID NOT NULL REFERENCES eventos_crudos(id),
        requested_by UUID REFERENCES users(id),
        reprocess_type VARCHAR(20) NOT NULL DEFAULT 'full',
        previous_status VARCHAR(40),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Create f1_inbound_channels table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS f1_inbound_channels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        canal VARCHAR(20) NOT NULL,
        wa_phone_number_id VARCHAR(40),
        wa_webhook_secret VARCHAR(200),
        email_address VARCHAR(160),
        email_oauth_refresh_token_enc TEXT,
        email_provider VARCHAR(20),
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_f1_channels_client ON f1_inbound_channels (client_id, canal, activo);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS f1_inbound_channels;`);
    await queryRunner.query(`DROP TABLE IF EXISTS f1_reprocess_log;`);
    await queryRunner.query(`DROP TABLE IF EXISTS equivalencias_ocr_cc;`);
    await queryRunner.query(`DROP TYPE IF EXISTS destino_reporte;`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_documento;`);
    await queryRunner.query(`DROP TYPE IF EXISTS processing_status_f1;`);
  }
}