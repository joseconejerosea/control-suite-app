import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT_TABLES = [
  'projects',
  'campaigns',
  'activations',
  'activation_events',
  'promoters',
  'locations',
  'collaborators',
  'document_uploads',
  'invoices',
  'rendiciones',
  'rendicion_items',
  'bodegas',
  'skus',
  'movimientos_pop',
  'checkins',
  'incidencias',
  'montaje_evidencias',
  'reportes_avance',
  'reportes_cliente',
  'canal_entrada',
];

export class EnableRLS1700000000036 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      const policyName = `rls_${table}_tenant_isolation`;

      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);

      await queryRunner.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = '${policyName}'
          ) THEN
            CREATE POLICY ${policyName} ON ${table}
              USING (client_id = current_setting('app.current_tenant', true)::uuid);
          END IF;
        END $$
      `);
    }

    const TENANT_ID_TABLES = ['audit_logs', 'project_inbox'];
    for (const table of TENANT_ID_TABLES) {
      const policyName = `rls_${table}_tenant_isolation`;

      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);

      await queryRunner.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = '${policyName}'
          ) THEN
            CREATE POLICY ${policyName} ON ${table}
              USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
          END IF;
        END $$
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const allTables = [...TENANT_TABLES, 'audit_logs', 'project_inbox'];
    for (const table of allTables) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_${table}_tenant_isolation ON ${table}`,
      );
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
  }
}
