import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentUploads1700000000016 implements MigrationInterface {
  name = 'CreateDocumentUploads1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE document_uploads (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        uploaded_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        project_id      UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
        original_name   VARCHAR(500) NOT NULL,
        mime_type       VARCHAR(100) NOT NULL,
        file_size       INTEGER NOT NULL,
        storage_path    VARCHAR(1000) NOT NULL,
        status          VARCHAR(30) NOT NULL DEFAULT 'uploaded',
        parse_result    JSONB NULL,
        target_table    VARCHAR(100) NULL,
        rows_inserted   INTEGER NULL DEFAULT 0,
        rows_failed     INTEGER NULL DEFAULT 0,
        error_detail    TEXT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT CHK_DOCUPLOADS_STATUS CHECK (status IN ('uploaded','processing','parsed','populated','error')),
        CONSTRAINT CHK_DOCUPLOADS_TARGET CHECK (
          target_table IS NULL OR target_table IN ('promoters','locations','campaigns','activations','collaborators')
        )
      );
    `);

    await queryRunner.query(`CREATE INDEX IDX_DOCUPLOADS_CLIENT ON document_uploads(client_id);`);
    await queryRunner.query(`CREATE INDEX IDX_DOCUPLOADS_STATUS ON document_uploads(status);`);
    await queryRunner.query(`CREATE INDEX IDX_DOCUPLOADS_PROJECT ON document_uploads(project_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_DOCUPLOADS_PROJECT;`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_DOCUPLOADS_STATUS;`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_DOCUPLOADS_CLIENT;`);
    await queryRunner.query(`DROP TABLE IF EXISTS document_uploads;`);
  }
}
