import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F4 Tier 2 · Fase 1 (FUNDACIONES) — historial de mensajes de convocatoria.
 *
 * convocatoria_mensajes registra cada mensaje IN/OUT del ciclo de convocatoria
 * por WhatsApp (envío OUTBOUND, respuesta INBOUND del promotor). Es el log que
 * la Fase 2 (clasificación IA) y la Fase 3 (ciclo de vida) leen para reconstruir
 * la conversación y decidir escalados.
 *
 * - convocatoria_id / evento_crudo_id nullable: un mensaje puede existir antes de
 *   resolver a qué convocatoria pertenece (alta urgente, número desconocido), y
 *   los OUTBOUND que no nacen de un evento entrante no tienen evento_crudo.
 * - RLS: policy tenant estándar, mismo patrón que ExtendRLSCoverage (040).
 */
export class CreateConvocatoriaMensajes1700000000046 implements MigrationInterface {
  name = 'CreateConvocatoriaMensajes1700000000046';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE convocatoria_mensajes (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id        UUID NOT NULL,
        proyecto_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        persona_id       UUID NOT NULL,
        convocatoria_id  UUID REFERENCES convocatorias(id) ON DELETE SET NULL,
        direction        VARCHAR(10) NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
        body             TEXT,
        wa_message_id    VARCHAR(255),
        evento_crudo_id  UUID REFERENCES eventos_crudos(id) ON DELETE SET NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX idx_convocatoria_mensajes_proyecto ON convocatoria_mensajes(client_id, proyecto_id)`);
    await qr.query(`CREATE INDEX idx_convocatoria_mensajes_persona  ON convocatoria_mensajes(client_id, persona_id)`);

    // RLS — mismo patrón endurecido (NULLIF + WITH CHECK) que 039/040.
    const TENANT_EXPR = `NULLIF(current_setting('app.current_tenant', true), '')::uuid`;
    await qr.query(`ALTER TABLE convocatoria_mensajes ENABLE ROW LEVEL SECURITY`);
    await qr.query(`DROP POLICY IF EXISTS rls_convocatoria_mensajes_tenant_isolation ON convocatoria_mensajes`);
    await qr.query(`
      CREATE POLICY rls_convocatoria_mensajes_tenant_isolation ON convocatoria_mensajes
        USING (client_id = ${TENANT_EXPR})
        WITH CHECK (client_id = ${TENANT_EXPR})
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP POLICY IF EXISTS rls_convocatoria_mensajes_tenant_isolation ON convocatoria_mensajes`);
    await qr.query(`DROP TABLE IF EXISTS convocatoria_mensajes CASCADE`);
  }
}
