/// <reference types="jest" />
// NOTE(B5/JD-003): these specs mock DataSource.query and only string-match the
// emitted SQL — they document intent/shape but CANNOT prove real ON CONFLICT DO
// UPDATE per-row semantics or the partial unique index behavior. That real behavior
// (dedup, trim, deactivate-on-remove, re-activate, empty-list deactivation) IS proven
// against a real Postgres cluster in `test/b5-project-locations.e2e-spec.ts`
// (gated: skips if no DB; run with `npm run test:e2e`).
/**
 * Spec para syncProjectLocations() — helper privado de ProjectsService.
 *
 * La función debe:
 *   1. INSERT new locations (by lower(name)) when not yet present.
 *   2. UPDATE address if a location with the same lower(name) already exists.
 *   3. DEACTIVATE (status='inactive') project-linked locations whose name is
 *      no longer in the current config.locales (preserve FK references — NO DELETE).
 *
 * Strategy: export the pure helper separately from the service for direct unit
 * testing without NestJS/DB bootstrap, OR test through the service with a mock DS.
 * We mock the DataSource.query to capture SQL calls and verify behavior.
 */
import { syncProjectLocations, ProjectsService } from './projects.service';

// ── DataSource mock that simulates upsert + deactivate ───────────────────────
function makeDs(existingRows: { id: string; lower_name: string }[] = []) {
  // First call → SELECT existing rows for deactivation check
  // Subsequent INSERT calls return []
  let callCount = 0;
  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      callCount++;
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        // Return existing project-linked locations
        return existingRows;
      }
      return [];
    }),
    _callCount: () => callCount,
  } as any;
}

const CLIENT_ID  = 'client-aaa';
const PROJECT_ID = 'project-bbb';

describe('syncProjectLocations()', () => {
  describe('insert new locations', () => {
    it('inserts a new location when locales array has one entry', async () => {
      const ds = makeDs([]); // no existing locations
      const locales = [{ nombre: 'Tienda Norte', direccion: 'Av. Principal 1' }];

      await syncProjectLocations(ds, CLIENT_ID, PROJECT_ID, locales);

      const insertCall = (ds.query as jest.Mock).mock.calls.find(
        ([sql]: [string]) =>
          sql.trim().toUpperCase().startsWith('INSERT') &&
          sql.includes('locations'),
      );
      expect(insertCall).toBeDefined();
      const [sql, params] = insertCall as [string, unknown[]];
      expect(sql).toContain('project_id');
      expect(params).toContain(CLIENT_ID);
      expect(params).toContain(PROJECT_ID);
      expect(params).toContain('Tienda Norte');
    });

    it('inserts multiple locations for each entry in locales array', async () => {
      const ds = makeDs([]);
      const locales = [
        { nombre: 'Local A', direccion: 'Calle A' },
        { nombre: 'Local B', direccion: 'Calle B' },
      ];

      await syncProjectLocations(ds, CLIENT_ID, PROJECT_ID, locales);

      const insertCalls = (ds.query as jest.Mock).mock.calls.filter(
        ([sql]: [string]) =>
          sql.trim().toUpperCase().startsWith('INSERT') &&
          sql.includes('locations'),
      );
      // Two separate inserts OR one batch insert — at least one call per location
      const totalInserted = insertCalls.reduce((acc, [, params]) => {
        const names = (params as unknown[]).filter((p) => p === 'Local A' || p === 'Local B');
        return acc + names.length;
      }, 0);
      expect(totalInserted).toBeGreaterThanOrEqual(2);
    });
  });

  describe('deactivate removed locations', () => {
    it('deactivates locations whose name is no longer in the current locales', async () => {
      // Existing DB locations for this project
      const existing = [
        { id: 'loc-old', lower_name: 'tienda vieja' },
      ];
      const ds = makeDs(existing);
      // New locales list does NOT include 'tienda vieja'
      const locales = [{ nombre: 'Tienda Nueva', direccion: 'Av. Nueva 1' }];

      await syncProjectLocations(ds, CLIENT_ID, PROJECT_ID, locales);

      const deactivateCall = (ds.query as jest.Mock).mock.calls.find(
        ([sql]: [string]) =>
          sql.includes('UPDATE') &&
          sql.includes('locations') &&
          sql.toLowerCase().includes('inactive'),
      );
      expect(deactivateCall).toBeDefined();
      const [sql, params] = deactivateCall as [string, unknown[]];
      expect(params).toContain('loc-old');
    });

    it('deactivates ALL project-linked locations when locales is empty (clearing PDVs)', async () => {
      // JB-001 — clearing a project's PDVs (empty locales) must deactivate every
      // previously-synced row. The pure helper already handles empty; this guards
      // that the empty case still issues the deactivation UPDATE for each row.
      const existing = [
        { id: 'loc-1', lower_name: 'local uno' },
        { id: 'loc-2', lower_name: 'local dos' },
      ];
      const ds = makeDs(existing);

      await syncProjectLocations(ds, CLIENT_ID, PROJECT_ID, []);

      const deactivateCalls = (ds.query as jest.Mock).mock.calls.filter(
        ([sql]: [string]) =>
          sql.includes('UPDATE') &&
          sql.includes('locations') &&
          sql.toLowerCase().includes('inactive'),
      );
      expect(deactivateCalls.length).toBe(2);
      const deactivatedIds = deactivateCalls.map(([, params]) => (params as unknown[])[0]);
      expect(deactivatedIds).toEqual(expect.arrayContaining(['loc-1', 'loc-2']));
    });

    it('does NOT deactivate if the location name is still in locales (case-insensitive)', async () => {
      const existing = [
        { id: 'loc-keep', lower_name: 'tienda norte' },
      ];
      const ds = makeDs(existing);
      // Same name but different casing — still matches
      const locales = [{ nombre: 'TIENDA NORTE', direccion: 'Av. 1' }];

      await syncProjectLocations(ds, CLIENT_ID, PROJECT_ID, locales);

      const deactivateCall = (ds.query as jest.Mock).mock.calls.find(
        ([sql]: [string]) =>
          sql.includes('UPDATE') &&
          sql.includes('locations') &&
          sql.toLowerCase().includes('inactive'),
      );
      // Should NOT be called because the name still matches
      expect(deactivateCall).toBeUndefined();
    });
  });

  // ── JB-001: the private syncLocationsFromConfig wrapper (via update()) ──────
  // The wrapper must ALWAYS call syncProjectLocations, even when the merged
  // locales list is empty. An early `if (!merged.length) return;` would skip the
  // sync and leave previously-synced PDVs active forever when the user clears them.
  describe('syncLocationsFromConfig (via ProjectsService.update) — clearing PDVs', () => {
    function makeServiceWithExisting(existing: { id: string; lower_name: string }[]) {
      // update() first reads the project (findOne → repo → getRepository), then runs
      // repo.update, then some F4 SQL, then the B5 sync. We route by SQL text and
      // capture the location deactivation UPDATEs.
      const query = jest.fn((sql: string) => {
        const s = String(sql);
        // syncProjectLocations step 1: SELECT existing project-linked locations
        if (/SELECT\s+id,\s+lower\(name\)/i.test(s)) return Promise.resolve(existing);
        return Promise.resolve([]);
      });

      const project = {
        id: PROJECT_ID,
        name: 'P',
        description: null,
        objectives: null,
        status: 'active',
        start_date: null,
        end_date: null,
        budget: null,
        config: { locales: [] },
      };

      const repo = {
        findOne: jest.fn().mockResolvedValue(project),
        // repo.update returns the updated project with the new (empty) config
        update: jest.fn().mockResolvedValue({ ...project, config: { locales: [] } }),
      };

      const dataSource = {
        query,
        getRepository: jest.fn().mockReturnValue(repo),
      } as any;
      const wa = { sendText: jest.fn().mockResolvedValue(undefined) } as any;
      const waOutput = {} as any;
      const stockReturns = { triggerReturnRequests: jest.fn() } as any;

      const service = new ProjectsService(dataSource, wa, waOutput, stockReturns);
      // Swap the TenantRepository instance the constructor built with our mock repo.
      (service as any).repo = repo;
      return { service, query };
    }

    it('deactivates existing PDVs when config.locales is cleared to empty', async () => {
      const { service, query } = makeServiceWithExisting([
        { id: 'loc-existing', lower_name: 'local viejo' },
      ]);

      await service.update(CLIENT_ID, PROJECT_ID, { config: { locales: [] } } as any);

      const deactivateCall = query.mock.calls.find(
        (call: unknown[]) => {
          const sql = String(call[0]);
          return sql.includes('UPDATE') && sql.includes('locations') && sql.toLowerCase().includes('inactive');
        },
      );
      expect(deactivateCall).toBeDefined();
      expect((deactivateCall as unknown[])[1]).toContain('loc-existing');
    });
  });

  describe('skip empty / null entries', () => {
    it('skips locales entries with missing or empty nombre', async () => {
      const ds = makeDs([]);
      const locales = [
        { nombre: '', direccion: 'Av. 1' },
        { nombre: null as any, direccion: 'Av. 2' },
        { nombre: 'Valid Location', direccion: 'Av. 3' },
      ];

      await syncProjectLocations(ds, CLIENT_ID, PROJECT_ID, locales);

      const insertCalls = (ds.query as jest.Mock).mock.calls.filter(
        ([sql]: [string]) =>
          sql.trim().toUpperCase().startsWith('INSERT') &&
          sql.includes('locations'),
      );
      // Only 'Valid Location' should be inserted, not the empty/null ones
      const allParams = insertCalls.flatMap(([, params]) => params as unknown[]);
      expect(allParams).toContain('Valid Location');
      expect(allParams).not.toContain('');
      expect(allParams).not.toContain(null);
    });
  });
});
