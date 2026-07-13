import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El lifecycle de F4 cierra proyectos con status='closed' (projects.service.ts:87,
 * que dispara triggerReturnRequests → devoluciones F3). Pero la CHECK original
 * (migración 013) solo permitía 'active'/'paused'/'archived', así que cerrar un
 * proyecto violaba la constraint y devolvía 500. Se agrega 'closed'.
 *
 * Nota: la constraint fue creada sin comillas en la 013, por lo que Postgres la
 * guardó en minúsculas (chk_projects_status). El DROP sin comillas la resuelve.
 */
export class AllowClosedProjectStatus1700000000059 implements MigrationInterface {
  name = 'AllowClosedProjectStatus1700000000059';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE projects DROP CONSTRAINT IF EXISTS CHK_PROJECTS_STATUS`);
    await qr.query(`
      ALTER TABLE projects
        ADD CONSTRAINT CHK_PROJECTS_STATUS
        CHECK (status IN ('active','paused','archived','closed'))
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE projects DROP CONSTRAINT IF EXISTS CHK_PROJECTS_STATUS`);
    await qr.query(`
      ALTER TABLE projects
        ADD CONSTRAINT CHK_PROJECTS_STATUS
        CHECK (status IN ('active','paused','archived'))
    `);
  }
}
