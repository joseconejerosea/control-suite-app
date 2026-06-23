import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 · paso 1 — Endurecer las policies RLS existentes (creadas en
 * 1700000000036-EnableRLS).
 *
 * Dos cambios sobre cada policy:
 *  1. NULLIF(current_setting('app.current_tenant', true), '')::uuid
 *     Tras una transacción, el GUC custom de namespace (app.*) vuelve a '' (no
 *     NULL) en la conexión del pool. La versión original casteaba '' ::uuid y
 *     LANZABA error. NULLIF convierte '' → NULL → la policy filtra a 0 filas en
 *     vez de explotar. (Descubierto en el PoC de binding.)
 *  2. WITH CHECK explícito además de USING. NOTA: Postgres ya usa USING como
 *     check de escritura cuando falta WITH CHECK, así que esto NO abre/cierra un
 *     agujero — la escritura cross-tenant ya estaba bloqueada por USING. Se hace
 *     explícito por CLARIDAD de intención y para permitir que, a futuro, la
 *     visibilidad (USING) y el check de escritura (WITH CHECK) puedan diferir.
 *     (Verificado empíricamente: quitar WITH CHECK no cambia el bloqueo.)
 *
 * El cambio de seguridad REAL acá es el NULLIF (robustez), no el WITH CHECK.
 *
 * Seguro de aplicar antes del binding: mientras el rol runtime tenga BYPASSRLS,
 * estas policies siguen inertes. Sólo muerden cuando se apunte DB_USERNAME a un
 * rol sin BYPASSRLS (paso final de Fase 2).
 */

// Tablas tenant scopeadas por `client_id` (idénticas a EnableRLS).
const CLIENT_ID_TABLES = [
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

// Tablas tenant scopeadas por `tenant_id`.
const TENANT_ID_TABLES = ['audit_logs', 'project_inbox'];

const TENANT_EXPR = `NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

export class HardenRLSPolicies1700000000039 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of CLIENT_ID_TABLES) {
      await this.recreatePolicy(queryRunner, table, 'client_id', true);
    }
    for (const table of TENANT_ID_TABLES) {
      await this.recreatePolicy(queryRunner, table, 'tenant_id', true);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restaura las policies originales: solo USING, casteo directo, sin NULLIF.
    for (const table of CLIENT_ID_TABLES) {
      await this.recreatePolicy(queryRunner, table, 'client_id', false);
    }
    for (const table of TENANT_ID_TABLES) {
      await this.recreatePolicy(queryRunner, table, 'tenant_id', false);
    }
  }

  private async recreatePolicy(
    queryRunner: QueryRunner,
    table: string,
    column: 'client_id' | 'tenant_id',
    hardened: boolean,
  ): Promise<void> {
    const policyName = `rls_${table}_tenant_isolation`;
    await queryRunner.query(`DROP POLICY IF EXISTS ${policyName} ON ${table}`);

    if (hardened) {
      await queryRunner.query(`
        CREATE POLICY ${policyName} ON ${table}
          USING (${column} = ${TENANT_EXPR})
          WITH CHECK (${column} = ${TENANT_EXPR})
      `);
    } else {
      await queryRunner.query(`
        CREATE POLICY ${policyName} ON ${table}
          USING (${column} = current_setting('app.current_tenant', true)::uuid)
      `);
    }
  }
}
