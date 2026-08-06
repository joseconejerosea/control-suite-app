import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 · E6a — Crea el rol de aplicación dedicado (NOBYPASSRLS, no owner) al
 * que apuntará DB_USERNAME en runtime. Las migraciones siguen corriendo con el
 * superusuario/owner (postgres); este rol es SOLO para runtime → queda sujeto a
 * RLS.
 *
 * Credenciales por entorno (NO hardcodeadas):
 *   DB_APP_USERNAME (default 'controlsuite_app'), DB_APP_PASSWORD.
 * Si DB_APP_PASSWORD no está seteada (CI/local), la migración se OMITE — el rol
 * se crea sólo en entornos que proveen la credencial por deploy.
 *
 * Grants amplios a nivel schema: el aislamiento lo da RLS, no los grants. Incluye
 * ALTER DEFAULT PRIVILEGES para que las tablas/secuencias futuras (migraciones
 * posteriores, corridas por el owner) hereden los permisos.
 */
export class CreateAppRole1700000000041 implements MigrationInterface {
  private ident(): string {
    return (process.env.DB_APP_USERNAME ?? 'controlsuite_app').replace(/[^a-zA-Z0-9_]/g, '');
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const pass = process.env.DB_APP_PASSWORD;
    if (!pass) {
      // eslint-disable-next-line no-console
      console.warn(
        '[CreateAppRole] DB_APP_PASSWORD no seteada — se omite la creación del rol de aplicación.',
      );
      return;
    }
    const role = this.ident();
    const escPass = pass.replace(/'/g, "''");

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} LOGIN PASSWORD '${escPass}' NOBYPASSRLS;
        END IF;
      END $$
    `);
    // Asegurar atributos aun si el rol preexistía.
    await queryRunner.query(`ALTER ROLE ${role} LOGIN NOBYPASSRLS`);

    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await queryRunner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    // Tablas y secuencias futuras (creadas por el owner de las migraciones).
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    );
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!process.env.DB_APP_PASSWORD) return;
    const role = this.ident();

    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${role}`,
    );
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM ${role}`,
    );
    await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM ${role}`);
    await queryRunner.query(`DROP ROLE IF EXISTS ${role}`);
  }
}
