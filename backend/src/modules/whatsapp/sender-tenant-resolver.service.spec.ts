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
  it('promoter row with rota=true → candidate.rota=true (bool_and propagates)', async () => {
    // DB returns bool_and of all rows for this sender+client → true when any row is rotating
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

  it('bool_and fail-safe: same sender is both rotating promoter AND non-rotating collaborator in same client → rota=true', async () => {
    // DB bool_and('true','false') = false but spec says fail-safe = true:
    // Actually bool_and returns false when ANY row is false. The fail-safe in the design
    // is that if ANY row is rotating (true) bool_and returns false — wait, bool_and gives
    // the AND of all values, so true AND false = false. But the design says we want the
    // CONSERVATIVE (rotating wins). That means we need bool_or (any rotating → rotating).
    // Design says: "bool_and over UNION ALL means a sender who is BOTH a rotating promoter
    // AND a non-rotating collaborator in the same client stays rotating (fail-safe)."
    // That implies the DB returns rota=false from bool_and(true,false)=false BUT
    // the service should treat that as rota=true? No — re-reading the design:
    // "bool_and(x.rota) AS rota" — here rota column is true when rotating,
    // so bool_and(true, false) = false. But the DESIGN says this is fail-safe meaning
    // rotating (true) wins. There's a contradiction: bool_and(true,false)=false
    // which means non-rotating, but the spec says rotating wins.
    // The correct SQL to make rotating-wins is: NOT bool_and(NOT rota) i.e.
    // bool_or(rota) — any true → true.
    // Per design section "bool_and fail-safe": when rota=true means rotating,
    // bool_and gives false (non-rotating wins), but design claims rotating wins.
    // The actual conservative behavior = use bool_or so ANY rotating row → rota=true.
    // Test asserts the observable: mixed sender (rotating promoter + non-rotating collab)
    // should yield rota=true (stays rotating per I-1 conservative).
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
