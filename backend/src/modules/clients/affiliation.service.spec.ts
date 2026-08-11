/// <reference types="jest" />
import { DataSource } from 'typeorm';
import { AffiliationService } from './affiliation.service';
import { normalizePhone } from '../../common/utils/normalize-phone';

// affiliate() writes under the tenant (runWithTenant sets app.current_tenant so the
// INSERT satisfies RLS WITH CHECK). For a unit test we make it a pass-through and
// assert the SQL directly against a mocked ds.query.
jest.mock('../../common/tenant/tenant-context', () => ({
  runWithTenant: (_ds: unknown, _clientId: string, fn: () => unknown) => fn(),
}));

describe('AffiliationService — affiliate', () => {
  const CLIENT_ID = 'c1';
  const FROM = '549111234567';

  let service: AffiliationService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn();
    const ds = { query } as unknown as DataSource;
    service = new AffiliationService(ds);
  });

  it('creates an ACTIVE promoter when the phone is not yet an active actor of the client', async () => {
    query
      .mockResolvedValueOnce([]) // existence check → none
      .mockResolvedValueOnce([{ id: 'p1' }]); // insert → new id

    const result = await service.affiliate(CLIENT_ID, FROM);

    expect(result).toEqual({ promoterId: 'p1', created: true });

    const [insertSql, insertParams] = query.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO promoters/i);
    // Both active flags must be set — the sender gate filters on status='active'.
    expect(insertSql).toMatch(/'active'/);
    expect(insertParams).toEqual(expect.arrayContaining([CLIENT_ID, FROM]));
  });

  it('is idempotent: returns the existing promoter without inserting', async () => {
    query.mockResolvedValueOnce([{ id: 'existing' }]); // existence check → found

    const result = await service.affiliate(CLIENT_ID, FROM);

    expect(result).toEqual({ promoterId: 'existing', created: false });
    expect(query).toHaveBeenCalledTimes(1); // no INSERT
  });

  it('matches the existing-actor check by phone digits only', async () => {
    query.mockResolvedValueOnce([{ id: 'existing' }]);

    const raw = '+54 9 11 1234-567';
    await service.affiliate(CLIENT_ID, raw);

    const [checkSql, checkParams] = query.mock.calls[0];
    expect(checkSql).toMatch(/regexp_replace/);
    expect(checkParams).toContain(normalizePhone(raw));
  });
});
