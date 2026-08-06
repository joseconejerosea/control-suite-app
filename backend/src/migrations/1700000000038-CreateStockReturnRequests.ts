import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStockReturnRequests1700000000038 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stock_return_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES clients(id),
        project_id UUID NOT NULL REFERENCES projects(id),
        persona_id UUID NOT NULL,
        items JSONB NOT NULL DEFAULT '[]',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        photo_key VARCHAR(512),
        photo_classification VARCHAR(50),
        photo_received_at TIMESTAMPTZ,
        rejection_reason TEXT,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        confirmed_at TIMESTAMPTZ,
        confirmed_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_stock_return_client_status ON stock_return_requests (client_id, status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS stock_return_requests`);
  }
}
