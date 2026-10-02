import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { DB } from './helpers';
import { syncProjectLocations } from '../src/modules/projects/projects.service';
import { AddProjectIdToLocations1700000000073 } from '../src/migrations/1700000000073-AddProjectIdToLocations';

/**
 * B5 / JD-003 — Integration test against a REAL Postgres cluster.
 *
 * The unit specs (`projects.sync-locations.service.spec.ts`, the migration spec)
 * only mock `query` and string-match SQL, so they cannot prove the behaviours that
 * actually matter for B5 and that the Judgment-Day judges disagreed on:
 *   - the PARTIAL UNIQUE index `(client_id, project_id, lower(name)) WHERE project_id IS NOT NULL`
 *   - `ON CONFLICT DO NOTHING` deduping case/whitespace variants WITHIN a single
 *     multi-row backfill INSERT (JA-001 claimed this ABORTS; JB-007 said it's safe —
 *     this test settles it against real Postgres),
 *   - `ON CONFLICT DO UPDATE` per-row upsert + re-activation in the runtime sync,
 *   - trim / empty-skip normalization, and the deactivate-on-remove / deactivate-on-empty
 *     (JB-001) behaviour.
 *
 * GATED: if the disposable PG17 cluster (DB_HOST/DB_PORT, default 127.0.0.1:5433
 * db `controlsuite_test`) is not reachable, the suite skips gracefully instead of
 * failing — so it never blocks a DB-less local run or CI. Run it with the cluster up:
 *   npm run test:e2e -- b5-project-locations
 */

const CLIENT = randomUUID();
const PROJECT_SYNC = randomUUID();   // exercised via syncProjectLocations()
const PROJECT_BACKFILL = randomUUID(); // exercised via the migration backfill

describe('B5 — project-scoped locations (integration, real Postgres)', () => {
  let ds: DataSource;
  let dbUp = false;

  beforeAll(async () => {
    ds = new DataSource({ type: 'postgres', ...DB, ssl: false, synchronize: false });
    try {
      await ds.initialize();
      dbUp = true;
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        '[b5-project-locations.e2e] Postgres cluster not reachable — SKIPPING integration suite.',
      );
      return;
    }

    // Ensure the migration shape exists (idempotent up(): IF NOT EXISTS / guarded FK /
    // ON CONFLICT DO NOTHING). Safe to run against an already-migrated test DB.
    const qr = ds.createQueryRunner();
    try {
      await qr.connect();
      // Seed BEFORE running the migration so the backfill picks up PROJECT_BACKFILL.
      await ds.query(
        `INSERT INTO clients (id, nombre, status) VALUES ($1, 'B5 IT Client', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [CLIENT],
      );
      await ds.query(
        `INSERT INTO projects (id, client_id, name, status) VALUES ($1, $2, 'B5 IT Sync', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [PROJECT_SYNC, CLIENT],
      );
      // Project with config.locales containing: a name, a CASE-variant duplicate, a
      // WHITESPACE-variant, an EMPTY name, plus an overlapping ia_extracted.locales entry.
      const config = {
        locales: [
          { nombre: 'Jumbo', direccion: 'Av Uno 100' },
          { nombre: 'JUMBO', direccion: 'Av Uno 100 bis' }, // case dup → deduped
          { nombre: '  Lider  ', direccion: '   ' },          // trimmed; empty addr → NULL
          { nombre: '', direccion: 'x' },                      // empty name → skipped
        ],
        ia_extracted: {
          locales: [{ nombre: 'Jumbo', direccion: 'ignored (dup)' }], // overlaps → deduped
        },
      };
      await ds.query(
        `INSERT INTO projects (id, client_id, name, status, config)
         VALUES ($1, $2, 'B5 IT Backfill', 'active', $3::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [PROJECT_BACKFILL, CLIENT, JSON.stringify(config)],
      );

      await new AddProjectIdToLocations1700000000073().up(qr);
    } finally {
      await qr.release();
    }
  });

  afterAll(async () => {
    if (!dbUp) return;
    await ds.query(`DELETE FROM locations WHERE client_id = $1`, [CLIENT]);
    await ds.query(`DELETE FROM projects WHERE client_id = $1`, [CLIENT]);
    await ds.query(`DELETE FROM clients WHERE id = $1`, [CLIENT]);
    await ds.destroy();
  });

  const rowsFor = (projectId: string) =>
    ds.query(
      `SELECT name, address, status FROM locations
        WHERE client_id = $1 AND project_id = $2
        ORDER BY lower(name)`,
      [CLIENT, projectId],
    ) as Promise<{ name: string; address: string | null; status: string }[]>;

  // ── Migration backfill (proves DO NOTHING dedups same-command dupes: JA-001 vs JB-007) ──

  it('migration backfill dedups case/whitespace variants, trims, skips empty — no unique-index abort', async () => {
    if (!dbUp) return;
    const rows = await rowsFor(PROJECT_BACKFILL);
    const names = rows.map((r) => r.name);
    // 'Jumbo'/'JUMBO' collapse to ONE; ia_extracted 'Jumbo' overlaps (deduped);
    // '  Lider  ' trimmed; '' skipped. If DO NOTHING aborted on same-command dupes,
    // the migration up() would have thrown in beforeAll and this suite would fail.
    expect(names).toEqual(['Jumbo', 'Lider']);
    const lider = rows.find((r) => r.name === 'Lider')!;
    expect(lider.address).toBeNull(); // NULLIF(trim(''), '') → NULL
    expect(rows.every((r) => r.status === 'active')).toBe(true);
  });

  it('migration created the partial unique index on lower(name)', async () => {
    if (!dbUp) return;
    const idx = (await ds.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'locations' AND indexname = 'IDX_LOCATIONS_PROJECT_ID_NAME_UNIQUE'`,
    )) as { indexdef: string }[];
    expect(idx.length).toBe(1);
    const def = idx[0].indexdef.toLowerCase();
    // Postgres renders a lower() expression over a varchar column as lower((name)::text),
    // NOT lower(name) — so match leniently on the expression, not the exact string.
    expect(def).toMatch(/lower\(\(?name/);
    expect(def).toContain('where'); // partial
    expect(def).toContain('unique');
  });

  // ── Runtime sync (ON CONFLICT DO UPDATE per-row + deactivate) ──

  it('syncProjectLocations inserts, dedups (case/whitespace), trims, skips empty', async () => {
    if (!dbUp) return;
    await syncProjectLocations(ds, CLIENT, PROJECT_SYNC, [
      { nombre: 'Mall Centro', direccion: 'Centro 1' },
      { nombre: 'MALL CENTRO', direccion: 'Centro 1 bis' }, // case dup → 1 row
      { nombre: '  Mall Sur  ', direccion: '  ' },           // trimmed; empty addr → null
      { nombre: '', direccion: 'x' },                         // skipped
    ]);
    const rows = await rowsFor(PROJECT_SYNC);
    expect(rows.map((r) => r.name)).toEqual(['Mall Centro', 'Mall Sur']);
    expect(rows.find((r) => r.name === 'Mall Sur')!.address).toBeNull();
    expect(rows.every((r) => r.status === 'active')).toBe(true);
  });

  it('syncProjectLocations deactivates a removed PDV (does not delete) and re-activates on return', async () => {
    if (!dbUp) return;
    // Remove 'Mall Sur'
    await syncProjectLocations(ds, CLIENT, PROJECT_SYNC, [
      { nombre: 'Mall Centro', direccion: 'Centro 1' },
    ]);
    const afterRemove = (await ds.query(
      `SELECT name, status FROM locations WHERE client_id = $1 AND project_id = $2`,
      [CLIENT, PROJECT_SYNC],
    )) as { name: string; status: string }[];
    const byName = Object.fromEntries(afterRemove.map((r) => [r.name, r.status]));
    expect(byName['Mall Centro']).toBe('active');
    expect(byName['Mall Sur']).toBe('inactive'); // deactivated, not deleted

    // Bring 'Mall Sur' back → the ON CONFLICT DO UPDATE re-activates it (no duplicate row)
    await syncProjectLocations(ds, CLIENT, PROJECT_SYNC, [
      { nombre: 'Mall Centro', direccion: 'Centro 1' },
      { nombre: 'Mall Sur', direccion: 'Sur 2' },
    ]);
    const revived = await rowsFor(PROJECT_SYNC);
    expect(revived.map((r) => r.name)).toEqual(['Mall Centro', 'Mall Sur']);
    expect(revived.find((r) => r.name === 'Mall Sur')!.address).toBe('Sur 2');
  });

  it('syncProjectLocations with an EMPTY list deactivates ALL project PDVs (JB-001 fix)', async () => {
    if (!dbUp) return;
    await syncProjectLocations(ds, CLIENT, PROJECT_SYNC, []);
    const all = (await ds.query(
      `SELECT status FROM locations WHERE client_id = $1 AND project_id = $2`,
      [CLIENT, PROJECT_SYNC],
    )) as { status: string }[];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((r) => r.status === 'inactive')).toBe(true);
  });
});
