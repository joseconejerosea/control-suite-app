import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconcilia el DRIFT de esquema en las 4 tablas del modelo CRM
 * (campaigns, locations, promoters, activations).
 *
 * Síntoma: los list endpoints (`GET /api/campaigns|locations|promoters|activations`)
 * devolvían 500. Logs de Postgres:
 *   column Campaign.location_id does not exist
 *   column Location.region does not exist
 *   column Promoter.first_name does not exist
 *   column Activation.activation_date does not exist
 *
 * Causa: las ENTIDADES evolucionaron (columnas nuevas / renombradas) pero nunca
 * se escribieron las migraciones correspondientes. Con `synchronize: false` la
 * DB nunca se actualizó → TypeORM genera SELECTs con columnas inexistentes.
 *
 * Estrategia: `ADD COLUMN IF NOT EXISTS`, nullable (defaults sólo donde la entidad
 * los define). Idempotente y NO-DESTRUCTIVO — no dropea ni renombra nada. Si una
 * columna ya existe (posiblemente con nombre viejo), se agrega la nueva vacía y
 * las queries dejan de romper; un eventual backfill de data queda como follow-up.
 * Las columnas enum de status se agregan creando el tipo IF NOT EXISTS.
 */
export class ReconcileCrmSchemaDrift1700000000056 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── campaigns ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        ADD COLUMN IF NOT EXISTS "description" text,
        ADD COLUMN IF NOT EXISTS "start_date"  date,
        ADD COLUMN IF NOT EXISTS "end_date"    date,
        ADD COLUMN IF NOT EXISTS "budget"      numeric(12,2),
        ADD COLUMN IF NOT EXISTS "location_id" uuid,
        ADD COLUMN IF NOT EXISTS "project_id"  uuid
    `);

    // ── locations ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "locations"
        ADD COLUMN IF NOT EXISTS "address"     varchar(500),
        ADD COLUMN IF NOT EXISTS "city"        varchar(100),
        ADD COLUMN IF NOT EXISTS "region"      varchar(100),
        ADD COLUMN IF NOT EXISTS "postal_code" varchar(10),
        ADD COLUMN IF NOT EXISTS "status"      varchar(20) DEFAULT 'active'
    `);

    // ── promoters ──────────────────────────────────────────────────────────
    // status es enum → asegurar el tipo antes de agregar la columna.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'promoters_status_enum') THEN
          CREATE TYPE "promoters_status_enum" AS ENUM ('active', 'inactive', 'suspended');
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "promoters"
        ADD COLUMN IF NOT EXISTS "first_name" varchar(150),
        ADD COLUMN IF NOT EXISTS "last_name"  varchar(150),
        ADD COLUMN IF NOT EXISTS "email"      varchar(255),
        ADD COLUMN IF NOT EXISTS "phone"      varchar(20),
        ADD COLUMN IF NOT EXISTS "rut"        varchar(20),
        ADD COLUMN IF NOT EXISTS "status"     "promoters_status_enum" DEFAULT 'active'
    `);

    // ── activations ────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "activations"
        ADD COLUMN IF NOT EXISTS "campaign_id"       uuid,
        ADD COLUMN IF NOT EXISTS "location_id"       uuid,
        ADD COLUMN IF NOT EXISTS "promoter_id"       uuid,
        ADD COLUMN IF NOT EXISTS "project_id"        uuid,
        ADD COLUMN IF NOT EXISTS "status"            varchar DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "scheduled_at"      timestamp,
        ADD COLUMN IF NOT EXISTS "executed_at"       timestamp,
        ADD COLUMN IF NOT EXISTS "notes"             text,
        ADD COLUMN IF NOT EXISTS "activation_date"   date,
        ADD COLUMN IF NOT EXISTS "estado_f5"         varchar(20) DEFAULT 'pendiente',
        ADD COLUMN IF NOT EXISTS "cerrada_at"        timestamptz,
        ADD COLUMN IF NOT EXISTS "cierre_jsonb"      jsonb,
        ADD COLUMN IF NOT EXISTS "cierre_incompleto" boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS "location"          jsonb
    `);
  }

  public async down(): Promise<void> {
    // No-op deliberado: la migración es una reconciliación no-destructiva con
    // ADD IF NOT EXISTS. No podemos distinguir las columnas que creó de las que
    // ya existían, así que un DROP en el rollback podría borrar columnas legítimas
    // (y su data). No se revierte.
  }
}
