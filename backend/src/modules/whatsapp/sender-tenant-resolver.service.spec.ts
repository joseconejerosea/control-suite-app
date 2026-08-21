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

  // P1-T01: candidatesFor now returns rota per candidate
  it('returns a single candidate with rota field when the phone belongs to exactly one client', async () => {
    query.mockResolvedValueOnce([{ clientId: 'c1', clientName: 'Agencia Uno', rota: true }]);

    const result = await service.candidatesFor(FROM);

    expect(result).toEqual([{ clientId: 'c1', clientName: 'Agencia Uno', rota: true }]);
  });

  it('returns a single candidate with rota=false for non-rotating sender', async () => {
    query.mockResolvedValueOnce([{ clientId: 'c1', clientName: 'Agencia Uno', rota: false }]);

    const result = await service.candidatesFor(FROM);

    expect(result).toEqual([{ clientId: 'c1', clientName: 'Agencia Uno', rota: false }]);
  });

  it('returns every candidate with rota when the phone belongs to two or more clients (must ask)', async () => {
    query.mockResolvedValueOnce([
      { clientId: 'c1', clientName: 'Agencia Uno', rota: true },
      { clientId: 'c2', clientName: 'Agencia Dos', rota: false },
    ]);

    const result = await service.candidatesFor(FROM);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.clientId)).toEqual(['c1', 'c2']);
    expect(result[0].rota).toBe(true);
    expect(result[1].rota).toBe(false);
  });

  // P1-T01: rota propagation from UNION sources
  it('promoter row with rota=true → candidate.rota=true (bool_or propagates rotating)', async () => {
    // DB returns bool_or of all rows for this sender+client → true when ANY row is rotating.
    query.mockResolvedValueOnce([{ clientId: 'c1', clientName: 'Agencia Uno', rota: true }]);

    const result = await service.candidatesFor(FROM);

    expect(result[0].rota).toBe(true);
  });

  it('collaborator matched by role_label in enum → rota=false', async () => {
    // A collaborator with role_label=supervisor (non-rotating) and no promoter row
    query.mockResolvedValueOnce([{ clientId: 'c1', clientName: 'Agencia Uno', rota: false }]);

    const result = await service.candidatesFor(FROM);

    expect(result[0].rota).toBe(false);
  });

  it('users row (staff) → rota=false (constant false from UNION)', async () => {
    query.mockResolvedValueOnce([{ clientId: 'c1', clientName: 'Agencia Uno', rota: false }]);

    const result = await service.candidatesFor(FROM);

    expect(result[0].rota).toBe(false);
  });

  it('bool_or fail-safe: same sender is both rotating promoter AND non-rotating collaborator in same client → rota=true', async () => {
    // Rotating-wins fail-safe (I-1 conservative): if ANY row for this sender+client is
    // rotating, the candidate stays rotating. The SQL uses bool_or(x.rota), so
    // bool_or(true, false) = true. NOTE: this unit test only asserts the row→candidate
    // mapping over a pre-shaped mock row; it does NOT exercise the real aggregation.
    // See TODO(A2/JD-001 · integration) in the SQL-shape test below — proving bool_or
    // actually collapses a mixed rotating+non-rotating sender to true needs a DB-backed test.
    query.mockResolvedValueOnce([{ clientId: 'c1', clientName: 'Agencia Uno', rota: true }]);

    const result = await service.candidatesFor(FROM);

    expect(result[0].rota).toBe(true);
  });

  it('all rows non-rotating → candidate.rota=false', async () => {
    query.mockResolvedValueOnce([{ clientId: 'c1', clientName: 'Agencia Uno', rota: false }]);

    const result = await service.candidatesFor(FROM);

    expect(result[0].rota).toBe(false);
  });

  it('matches by phone digits only and scopes to promoters/collaborators/staff users; SQL uses role_label + is_active for collaborators', async () => {
    query.mockResolvedValueOnce([]);

    await service.candidatesFor(FROM);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/promoters/);
    expect(sql).toMatch(/collaborators/);
    expect(sql).toMatch(/users/);
    expect(sql).toMatch(/regexp_replace/);
    // P1-T01: collaborators branch must use role_label (not rol) and is_active (not status)
    expect(sql).toMatch(/role_label/);
    expect(sql).toMatch(/is_active/);
    // A2/JD-001: the per-client rota aggregation MUST stay rotating-wins. The original bug
    // was bool_and (any non-rotating row would flip a rotating sender to non-rotating).
    // Asserting bool_or + GROUP BY at the string level makes a revert to bool_and or a
    // dropped GROUP BY fail RED here, guarding the exact regression this fix closed.
    expect(sql).toMatch(/bool_or/i);
    expect(sql).toMatch(/GROUP BY/i);
    // COALESCE(rota, true): pre-migration promoters (NULL rota) default to rotating.
    expect(sql).toMatch(/COALESCE\(\s*rota/i);
    // TODO(A2/JD-001 · integration): these substring checks prove the SQL *shape* only.
    // They cannot prove real aggregation behavior — that a sender who is BOTH a rotating
    // promoter AND a non-rotating collaborator in the same client resolves to rota=true.
    // Proving that requires a DB-backed test (pg-mem or a real Postgres) that runs the
    // actual UNION + bool_or against seeded rows. Not faked here.
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
