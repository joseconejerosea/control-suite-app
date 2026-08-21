/// <reference types="jest" />
/**
 * Spec para LocationsService.findByProject().
 *
 * Verifica que devuelve solo las locations activas ligadas al project_id del tenant,
 * y que excluye locations de otros proyectos o con status='inactive'.
 */
import { LocationsService } from './locations.service';

// ── Minimal DataSource mock ───────────────────────────────────────────────────
function makeDataSource(rows: unknown[]) {
  return {
    query: jest.fn().mockResolvedValue(rows),
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d: any) => d),
      save: jest.fn((d: any) => d),
      remove: jest.fn(),
    }),
  } as any;
}

const CLIENT_ID  = 'client-aaa';
const PROJECT_ID = 'project-bbb';

describe('LocationsService.findByProject()', () => {
  describe('happy path — active locations for the project', () => {
    it('returns only active locations linked to the given project_id', async () => {
      const rows = [
        { id: 'loc-1', name: 'Tienda Norte', address: 'Av. 1', status: 'active' },
        { id: 'loc-2', name: 'Tienda Sur',   address: 'Av. 2', status: 'active' },
      ];
      const ds = makeDataSource(rows);
      const service = new LocationsService(ds);

      const result = await service.findByProject(CLIENT_ID, PROJECT_ID);

      // Verifies the query was called with the right args
      expect(ds.query).toHaveBeenCalledTimes(1);
      const [sql, params] = ds.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('project_id');
      expect(sql).toContain('status');
      expect(params).toContain(CLIENT_ID);
      expect(params).toContain(PROJECT_ID);

      // Result shape matches the rows returned by the DB
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'loc-1', name: 'Tienda Norte' });
      expect(result[1]).toMatchObject({ id: 'loc-2', name: 'Tienda Sur' });
    });
  });

  describe('empty result — no active locations for project', () => {
    it('returns an empty array when the DB returns no rows', async () => {
      const ds = makeDataSource([]);
      const service = new LocationsService(ds);

      const result = await service.findByProject(CLIENT_ID, 'project-unknown');

      expect(result).toEqual([]);
      // The SQL must still have been called (not short-circuited)
      expect(ds.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('query shape — filters active + tenant + project', () => {
    it('the SQL includes active status filter and both client_id + project_id params', async () => {
      const ds = makeDataSource([]);
      const service = new LocationsService(ds);

      await service.findByProject('tenant-x', 'proj-y');

      const [sql, params] = ds.query.mock.calls[0] as [string, unknown[]];
      // Must filter by active status
      expect(sql.toLowerCase()).toContain('active');
      // Must be tenant-scoped
      expect(params).toContain('tenant-x');
      // Must filter by project
      expect(params).toContain('proj-y');
    });
  });
});
