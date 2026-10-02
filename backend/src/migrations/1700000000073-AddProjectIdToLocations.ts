import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds project_id (nullable uuid FK → projects) to the locations table so that
 * each PDV/local can be individually linked to a project (B5).
 *
 * STRATEGY:
 *  - Nullable column: existing tenant-level locations are unaffected (project_id IS NULL).
 *  - FK ON DELETE CASCADE: removing a project cleans up its scoped locations.
 *  - Partial unique index (client_id, project_id, lower(name)) WHERE project_id IS NOT NULL:
 *    prevents per-project duplicates; allows the same name across different projects.
 *  - Backfill: reads both config->'locales' and config->'ia_extracted'->'locales' for every
 *    project that has them and INSERTs locations rows with project_id set. Deduped by
 *    (project_id, lower(name)) via ON CONFLICT DO NOTHING (partial index handles it).
 *
 * BACKFILL AUDIT (pre-run):
 *   SELECT p.id, p.config->'locales', p.config->'ia_extracted'->'locales'
 *   FROM projects p
 *   WHERE p.config->'locales' IS NOT NULL
 *      OR p.config->'ia_extracted'->'locales' IS NOT NULL;
 *   → Covers both extraction paths for production data.
 *
 * down(): drops column (CASCADE removes FK + dependent indexes implicitly via DROP COLUMN),
 *         then drops the explicit index names. Pre-existing tenant-level locations untouched.
 */
export class AddProjectIdToLocations1700000000073 implements MigrationInterface {
  name = 'AddProjectIdToLocations1700000000073';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Add project_id column (nullable)
    await q.query(`
      ALTER TABLE locations
        ADD COLUMN IF NOT EXISTS project_id uuid NULL
    `);

    // 2. Add FK: locations.project_id → projects(id) ON DELETE CASCADE.
    //    JB-004 — guarded so a partial re-run (constraint already added) doesn't abort;
    //    matches the IF NOT EXISTS idempotency used by the other DDL in this migration.
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_locations_project_id'
        ) THEN
          ALTER TABLE locations
            ADD CONSTRAINT fk_locations_project_id
            FOREIGN KEY (project_id)
            REFERENCES projects(id)
            ON DELETE CASCADE;
        END IF;
      END $$
    `);

    // 3. Index on project_id (for fast lookups by project)
    await q.query(`
      CREATE INDEX IF NOT EXISTS IDX_LOCATIONS_PROJECT_ID
        ON locations (project_id)
    `);

    // 4. Partial unique index: prevent per-project name duplicates.
    //    Uses lower(name) for case-insensitive dedup.
    //    WHERE project_id IS NOT NULL → tenant-level locations (project_id NULL) are exempt.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS IDX_LOCATIONS_PROJECT_ID_NAME_UNIQUE
        ON locations (client_id, project_id, lower(name))
        WHERE project_id IS NOT NULL
    `);

    // 5. Backfill from config->'locales' (root-level locales key set by project form)
    //    Inserts one locations row per local per project; skips empties and nulls.
    //    ON CONFLICT DO NOTHING is safe here: the partial unique index handles dupes.
    await q.query(`
      INSERT INTO locations (client_id, project_id, name, address, status)
      SELECT
        p.client_id,
        p.id AS project_id,
        trim(local_item->>'nombre') AS name,
        NULLIF(trim(local_item->>'direccion'), '') AS address,
        'active' AS status
      FROM projects p
      CROSS JOIN LATERAL jsonb_array_elements(p.config->'locales') AS local_item
      WHERE p.config->'locales' IS NOT NULL
        AND jsonb_typeof(p.config->'locales') = 'array'
        AND trim(local_item->>'nombre') <> ''
        AND local_item->>'nombre' IS NOT NULL
      ON CONFLICT (client_id, project_id, lower(name))
        WHERE project_id IS NOT NULL
        DO NOTHING
    `);

    // 6. Backfill from config->'ia_extracted'->'locales' (IA-extracted locales key).
    //    Same strategy as above; ON CONFLICT covers overlap between both paths.
    await q.query(`
      INSERT INTO locations (client_id, project_id, name, address, status)
      SELECT
        p.client_id,
        p.id AS project_id,
        trim(local_item->>'nombre') AS name,
        NULLIF(trim(local_item->>'direccion'), '') AS address,
        'active' AS status
      FROM projects p
      CROSS JOIN LATERAL jsonb_array_elements(p.config->'ia_extracted'->'locales') AS local_item
      WHERE p.config->'ia_extracted'->'locales' IS NOT NULL
        AND jsonb_typeof(p.config->'ia_extracted'->'locales') = 'array'
        AND trim(local_item->>'nombre') <> ''
        AND local_item->>'nombre' IS NOT NULL
      ON CONFLICT (client_id, project_id, lower(name))
        WHERE project_id IS NOT NULL
        DO NOTHING
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Drop indexes first (before dropping the column they reference)
    await q.query(`
      DROP INDEX IF EXISTS IDX_LOCATIONS_PROJECT_ID_NAME_UNIQUE
    `);

    await q.query(`
      DROP INDEX IF EXISTS IDX_LOCATIONS_PROJECT_ID
    `);

    // Dropping the column also drops the FK constraint (CASCADE behavior).
    // Pre-existing tenant-level locations (project_id IS NULL) remain untouched.
    await q.query(`
      ALTER TABLE locations
        DROP COLUMN IF EXISTS project_id
    `);
  }
}
