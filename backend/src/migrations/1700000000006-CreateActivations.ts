import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateActivations1700000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'activations',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'campaign_id', type: 'uuid', isNullable: false },
          { name: 'location_id', type: 'uuid', isNullable: true },
          { name: 'promoter_id', type: 'uuid', isNullable: true },
          { name: 'status', type: 'varchar', default: "'pending'" },
          { name: 'scheduled_at', type: 'timestamp', isNullable: true },
          { name: 'executed_at', type: 'timestamp', isNullable: true },
          { name: 'notes', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
          { name: 'updated_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('activations', new TableIndex({
      name: 'IDX_ACTIVATIONS_CLIENT_ID',
      columnNames: ['client_id'],
    }));

    await queryRunner.createIndex('activations', new TableIndex({
      name: 'IDX_ACTIVATIONS_STATUS',
      columnNames: ['status'],
    }));

    await queryRunner.createForeignKey('activations', new TableForeignKey({
      name: 'FK_ACTIVATIONS_CAMPAIGN',
      columnNames: ['campaign_id'],
      referencedTableName: 'campaigns',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    }));

    await queryRunner.createForeignKey('activations', new TableForeignKey({
      name: 'FK_ACTIVATIONS_LOCATION',
      columnNames: ['location_id'],
      referencedTableName: 'locations',
      referencedColumnNames: ['id'],
      onDelete: 'SET NULL',
    }));

    await queryRunner.createForeignKey('activations', new TableForeignKey({
      name: 'FK_ACTIVATIONS_PROMOTER',
      columnNames: ['promoter_id'],
      referencedTableName: 'promoters',
      referencedColumnNames: ['id'],
      onDelete: 'SET NULL',
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('activations', 'FK_ACTIVATIONS_PROMOTER');
    await queryRunner.dropForeignKey('activations', 'FK_ACTIVATIONS_LOCATION');
    await queryRunner.dropForeignKey('activations', 'FK_ACTIVATIONS_CAMPAIGN');
    await queryRunner.dropIndex('activations', 'IDX_ACTIVATIONS_STATUS');
    await queryRunner.dropIndex('activations', 'IDX_ACTIVATIONS_CLIENT_ID');
    await queryRunner.dropTable('activations');
  }
}