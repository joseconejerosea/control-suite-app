import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles Model · Fase 2a — asignación SERVICE_LEAD → agencia (tenant).
 *
 * El SERVICE_LEAD no tiene tenant fijo: puede operar varias agencias y elige la
 * activa al loguear (Diseño B — el JWT se re-emite con client_id = tenant elegido
 * y un marcador activeTenantId). Esta tabla es la fuente de verdad de qué agencias
 * tiene asignadas, y ServiceLeadGuard la consulta en cada request para validar el
 * tenant activo.
 *
 * ⚠️ PLATFORM-LEVEL / CROSS-TENANT — a propósito NO tiene RLS por tenant (no se
 * agrega a EnableRLS/HardenRLSPolicies). Aislarla por app.current_tenant la haría
 * invisible al propio SERVICE_LEAD. El rol de runtime (controlsuite_app,
 * NOBYPASSRLS) hereda los grants por ALTER DEFAULT PRIVILEGES (migración 041), así
 * que puede leerla/escribirla; sin RLS ve todas las filas, que es justo lo buscado.
 */
export class CreateServiceLeadTenants1700000000050 implements MigrationInterface {
  name = 'CreateServiceLeadTenants1700000000050';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE service_lead_tenants (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(
      `CREATE UNIQUE INDEX UQ_SERVICE_LEAD_TENANTS_USER_TENANT
         ON service_lead_tenants(user_id, tenant_id)`,
    );

    // NO se habilita RLS: tabla cross-tenant (ver cabecera). Intencional.
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS UQ_SERVICE_LEAD_TENANTS_USER_TENANT`);
    await qr.query(`DROP TABLE IF EXISTS service_lead_tenants CASCADE`);
  }
}
