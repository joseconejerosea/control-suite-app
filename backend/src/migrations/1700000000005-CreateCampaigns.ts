import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateCampaigns1700000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'campaigns',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'name', type: 'varchar', isNullable: false },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'status', type: 'varchar', default: "'draft'" },
          { name: 'start_date', type: 'timestamp', isNullable: true },
          { name: 'end_date', type: 'timestamp', isNullable: true },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
          { name: 'updated_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'campaigns',
      new TableIndex({
        name: 'IDX_CAMPAIGNS_CLIENT_ID',
        columnNames: ['client_id'],
      }),
    );
    await queryRunner.createIndex(
      'campaigns',
      new TableIndex({
        name: 'IDX_CAMPAIGNS_STATUS',
        columnNames: ['status'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('campaigns', 'IDX_CAMPAIGNS_STATUS');
    await queryRunner.dropIndex('campaigns', 'IDX_CAMPAIGNS_CLIENT_ID');
    await queryRunner.dropTable('campaigns');
  }
}
