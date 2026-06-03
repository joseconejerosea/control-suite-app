import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorageBucket1700000000035 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'control-suite',
        'control-suite',
        false,
        52428800,
        ARRAY[
          'image/jpeg', 'image/png', 'image/webp', 'image/heic',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'audio/ogg', 'audio/mpeg', 'audio/mp4',
          'video/mp4', 'video/quicktime'
        ]
      )
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM storage.buckets WHERE id = 'control-suite'`);
  }
}
