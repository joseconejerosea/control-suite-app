/// <reference types="jest" />
import { DataSource } from 'typeorm';
import { SenderTenantResolverService } from './sender-tenant-resolver.service';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { UserRole } from '../../common/enums/user-role.enum';

// `runAsSystem` is the cross-tenant discovery wrapper (BYPASSRLS system pool) used
// to resolve a sender before its tenant is known. For this unit test we make it a
// pass-through so we can assert the SQL and the row→candidate mapping directly
// against a mocked ds.query, without wiring a system DataSource.
jest.mock('../../common/tenant/tenant-context', () => ({
  runAsSystem: (fn: () => unknown) => fn(),
}));

describe('SenderTenantResolverService — candidatesFor', () => {
  const FROM = '+54 9 11 1234-5678';

  let service: SenderTenantResolverService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn();
    const ds = { query } as unknown as DataSource;
    service = new SenderTenantResolverService(ds);
  });

  it('returns [] when the sender phone is not registered in any client (unregistered → alta flow)', async () => {
    query.mockResolvedValueOnce([]);

    const result = await service.candidatesFor(FROM);

    expect(result).toEqual([]);
  });

  it('returns a single candidate when the phone belongs to exactly one client (auto-select)', async () => {
    query.mockResolvedValueOnce([{ clientId: 'c1', clientName: 'Agencia Uno' }]);

    const result = await service.candidatesFor(FROM);

    expect(result).toEqual([{ clientId: 'c1', clientName: 'Agencia Uno' }]);
  });

  it('returns every candidate when the phone belongs to two or more clients (must ask)', async () => {
    query.mockResolvedValueOnce([
      { clientId: 'c1', clientName: 'Agencia Uno' },
      { clientId: 'c2', clientName: 'Agencia Dos' },
    ]);

    const result = await service.candidatesFor(FROM);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.clientId)).toEqual(['c1', 'c2']);
  });

  it('matches by phone digits only and scopes to promoters/collaborators/staff users', async () => {
    query.mockResolvedValueOnce([]);

    await service.candidatesFor(FROM);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/promoters/);
    expect(sql).toMatch(/collaborators/);
    expect(sql).toMatch(/users/);
    expect(sql).toMatch(/regexp_replace/);
    // The phone is matched by its digits only (normalized), never the raw string.
    expect(params[0]).toBe(normalizePhone(FROM));
    // Staff roles that are allowed to operate the bot (platform roles excluded).
    expect(params).toEqual(
      expect.arrayContaining([UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERVISOR]),
    );
  });

  it('rethrows a DB error (a query failure is NOT a genuine 0-candidates result)', async () => {
    // A swallowed error would return [] and wrongly route the sender to the
    // affiliation-code path ("you're unregistered"). The controller must instead be
    // able to tell the sender to retry, so candidatesFor propagates the error.
    query.mockRejectedValueOnce(new Error('db down'));

    await expect(service.candidatesFor(FROM)).rejects.toThrow('db down');
  });
});

describe('SenderTenantResolverService — clientsWithOpenConvocatoria', () => {
  const FROM = '+54 9 11 1234-5678';

  let service: SenderTenantResolverService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn();
    const ds = { query } as unknown as DataSource;
    service = new SenderTenantResolverService(ds);
  });

  it('returns the distinct client ids from the query', async () => {
    query.mockResolvedValueOnce([{ clientId: 'c1' }, { clientId: 'c2' }]);

    const result = await service.clientsWithOpenConvocatoria(FROM);

    expect(result).toEqual(['c1', 'c2']);
  });

  it('returns [] when no promoter with a matching phone has an open convocatoria', async () => {
    query.mockResolvedValueOnce([]);

    const result = await service.clientsWithOpenConvocatoria(FROM);

    expect(result).toEqual([]);
  });

  it('returns [] for an empty/invalid phone without hitting the DB', async () => {
    const result = await service.clientsWithOpenConvocatoria('');

    expect(result).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('matches by phone digits only and scopes to open convocatorias (enviada/pendiente)', async () => {
    query.mockResolvedValueOnce([]);

    await service.clientsWithOpenConvocatoria(FROM);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/convocatorias/);
    expect(sql).toMatch(/promoters/);
    expect(sql).toMatch(/regexp_replace/);
    expect(sql).toMatch(/enviada/);
    expect(sql).toMatch(/pendiente/);
    // The phone is matched by its digits only (normalized), never the raw string.
    expect(params[0]).toBe(normalizePhone(FROM));
  });

  it('rethrows a DB error (a swallowed error would wrongly skip the convocatoria path)', async () => {
    // If this call swallowed the error and returned [], the controller would skip the
    // convocatoria auto-resolve and fall back to "which agency?", pre-empting the F4
    // reply. Re-throw so the caller can decide (best-effort fall-through).
    query.mockRejectedValueOnce(new Error('db down'));

    await expect(service.clientsWithOpenConvocatoria(FROM)).rejects.toThrow('db down');
  });
});
