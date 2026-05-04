import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateEventosCrudos1700000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'eventos_crudos',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'client_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'canal_entrada_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'payload',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'source',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'processed',
            type: 'boolean',
            default: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'eventos_crudos',
      new TableIndex({
        name: 'IDX_EVENTOS_CRUDOS_CLIENT_ID',
        columnNames: ['client_id'],
      }),
    );

    await queryRunner.createIndex(
      'eventos_crudos',
      new TableIndex({
        name: 'IDX_EVENTOS_CRUDOS_PROCESSED',
        columnNames: ['processed'],
      }),
    );

    await queryRunner.createForeignKey(
      'eventos_crudos',
      new TableForeignKey({
        name: 'FK_EVENTOS_CRUDOS_CANAL_ENTRADA',
        columnNames: ['canal_entrada_id'],
        referencedTableName: 'canal_entrada',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('eventos_crudos', 'FK_EVENTOS_CRUDOS_CANAL_ENTRADA');
    await queryRunner.dropIndex('eventos_crudos', 'IDX_EVENTOS_CRUDOS_PROCESSED');
    await queryRunner.dropIndex('eventos_crudos', 'IDX_EVENTOS_CRUDOS_CLIENT_ID');
    await queryRunner.dropTable('eventos_crudos');
  }
}