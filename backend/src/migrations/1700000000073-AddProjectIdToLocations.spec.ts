/// <reference types="jest" />
// NOTE(B5/JD-003): these specs mock QueryRunner.query and only string-match the
// emitted SQL — they document the migration shape but CANNOT prove real behavior.
// The real migration behavior (case-variant dedup on the partial unique index via
// ON CONFLICT DO NOTHING within one multi-row backfill, NULLIF address normalization,
// FK idempotency) IS proven against a real Postgres cluster in
// `test/b5-project-locations.e2e-spec.ts` (gated: skips if no DB; `npm run test:e2e`).
/**
 * Spec para la migración 1700000000073 — AddProjectIdToLocations.
 *
 * Verifica el comportamiento de up() y down() de forma unitaria:
 * mockeamos QueryRunner y comprobamos que los SQLs emitidos sean correctos.
 */
import { AddProjectIdToLocations1700000000073 } from './1700000000073-AddProjectIdToLocations';

function makeQueryRunner() {
  const calls: string[] = [];
  return {
    query: jest.fn(async (sql: string) => {
      calls.push(sql.trim());
      return [];
    }),
    _calls: calls,
  };
}

describe('AddProjectIdToLocations1700000000073', () => {
  let migration: AddProjectIdToLocations1700000000073;
  let qr: ReturnType<typeof makeQueryRunner>;

  beforeEach(() => {
    migration = new AddProjectIdToLocations1700000000073();
    qr = makeQueryRunner();
  });

  describe('up()', () => {
    beforeEach(async () => {
      await migration.up(qr as any);
    });

    it('adds project_id column (nullable uuid) to locations', () => {
      const sql = qr._calls.find(
        (s) => s.includes('ADD COLUMN') && s.includes('project_id'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain('locations');
      expect(sql).toContain('uuid');
    });

    it('adds FK constraint from locations.project_id to projects(id) ON DELETE CASCADE', () => {
      const sql = qr._calls.find(
        (s) =>
          s.includes('FOREIGN KEY') &&
          s.includes('project_id') &&
          s.includes('projects'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain('ON DELETE CASCADE');
    });

    it('creates an index on project_id', () => {
      const sql = qr._calls.find(
        (s) => s.includes('CREATE INDEX') && s.includes('project_id'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain('locations');
    });

    it('creates a partial unique index on (client_id, project_id, lower(name)) WHERE project_id IS NOT NULL', () => {
      const sql = qr._calls.find(
        (s) =>
          s.includes('CREATE UNIQUE INDEX') &&
          s.includes('project_id') &&
          s.includes('lower'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain('client_id');
      expect(sql).toContain('WHERE project_id IS NOT NULL');
    });

    it('performs a backfill INSERT from project config.locales (root-level)', () => {
      const sql = qr._calls.find(
        (s) =>
          s.includes('INSERT INTO locations') &&
          s.toLowerCase().includes('locales'),
      );
      expect(sql).toBeDefined();
      // Should use ON CONFLICT DO NOTHING or DO UPDATE for idempotency
      expect(sql).toMatch(/ON CONFLICT/i);
    });

    it('performs a backfill INSERT from project config.ia_extracted.locales', () => {
      const sql = qr._calls.find(
        (s) =>
          s.includes('INSERT INTO locations') &&
          s.toLowerCase().includes('ia_extracted'),
      );
      expect(sql).toBeDefined();
      expect(sql).toMatch(/ON CONFLICT/i);
    });

    it('executes at least 6 queries (column + FK + 2 indexes + 2 backfills)', () => {
      expect(qr._calls.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('down()', () => {
    beforeEach(async () => {
      await migration.down(qr as any);
    });

    it('drops the partial unique index', () => {
      const sql = qr._calls.find(
        (s) => s.includes('DROP INDEX') && s.includes('IDX_LOCATIONS_PROJECT_ID_NAME_UNIQUE'),
      );
      expect(sql).toBeDefined();
    });

    it('drops the project_id index', () => {
      const sql = qr._calls.find(
        (s) => s.includes('DROP INDEX') && s.includes('IDX_LOCATIONS_PROJECT_ID'),
      );
      expect(sql).toBeDefined();
    });

    it('drops project_id column (removes FK cascade)', () => {
      const sql = qr._calls.find(
        (s) => s.includes('DROP COLUMN') && s.includes('project_id'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain('locations');
    });

    it('does NOT drop the locations table', () => {
      const dropTable = qr._calls.find((s) => s.includes('DROP TABLE'));
      expect(dropTable).toBeUndefined();
    });
  });
});
