import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 · E3 (plan 2.2) — Extender la cobertura RLS a las tablas tenant que
 * EnableRLS (036) se salteó. Mismo patrón endurecido que HardenRLSPolicies
 * (039): NULLIF + WITH CHECK.
 *
 * Decisiones de cobertura (ver REMEDIATION-PLAN 2.2):
 *  - GRUPO A (12 tablas, client_id): policy estándar tenant.
 *  - equivalencias_ocr_cc: tiene filas GLOBALES (client_id IS NULL) que el
 *    clasificador OCR usa para todos los tenants (project-resolver:182,
 *    classify.processor:64). USING permite ver globales; WITH CHECK NO deja
 *    crear globales desde runtime (escritura sólo del propio tenant).
 *  - f1_reprocess_log: NO tiene client_id (sólo evento_crudo_id). Se aísla por
 *    subquery a eventos_crudos (que ya queda bajo RLS → filtra al tenant).
 *  - users: QUEDA FUERA de RLS a propósito. El login busca por email sin tenant
 *    (auth.service:39); con RLS nadie podría loguear. Protegida app-level (Capa 1).
 *
 * Seguro de aplicar antes del binding: inerte mientras el rol runtime tenga
 * BYPASSRLS.
 */

const TENANT_EXPR = `NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

// Grupo A — policy estándar por client_id.
const STANDARD_TABLES = [
  'eventos_crudos',
  'stock_return_requests',
  'mind_propuestas',
  'mind_acciones_log',
  'mind_chat_history',
  'ai_costs_log',
  'f1_inbound_channels',
  'proyecto_equipo',
  'convocatorias',
  'proyecto_versiones',
  'inventario',
  'tickets',
];

// Todas las tablas tocadas (para enable/disable + down).
const ALL_TABLES = [...STANDARD_TABLES, 'equivalencias_ocr_cc', 'f1_reprocess_log'];

export class ExtendRLSCoverage1700000000040 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ALL_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS rls_${table}_tenant_isolation ON ${table}`);
    }

    // Grupo A — estándar.
    for (const table of STANDARD_TABLES) {
      await queryRunner.query(`
        CREATE POLICY rls_${table}_tenant_isolation ON ${table}
          USING (client_id = ${TENANT_EXPR})
          WITH CHECK (client_id = ${TENANT_EXPR})
      `);
    }

    // equivalencias_ocr_cc — globales (NULL) visibles para todos; escritura
    // sólo del propio tenant.
    await queryRunner.query(`
      CREATE POLICY rls_equivalencias_ocr_cc_tenant_isolation ON equivalencias_ocr_cc
        USING (client_id = ${TENANT_EXPR} OR client_id IS NULL)
        WITH CHECK (client_id = ${TENANT_EXPR})
    `);

    // f1_reprocess_log — sin client_id; se aísla por su evento.
    await queryRunner.query(`
      CREATE POLICY rls_f1_reprocess_log_tenant_isolation ON f1_reprocess_log
        USING (evento_crudo_id IN (SELECT id FROM eventos_crudos))
        WITH CHECK (evento_crudo_id IN (SELECT id FROM eventos_crudos))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ALL_TABLES) {
      await queryRunner.query(`DROP POLICY IF EXISTS rls_${table}_tenant_isolation ON ${table}`);
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
  }
}
