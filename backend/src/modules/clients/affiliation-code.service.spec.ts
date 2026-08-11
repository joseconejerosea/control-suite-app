/// <reference types="jest" />
import { DataSource } from 'typeorm';
import { AffiliationCodeService } from './affiliation-code.service';

describe('AffiliationCodeService', () => {
  let service: AffiliationCodeService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn();
    const ds = { query } as unknown as DataSource;
    service = new AffiliationCodeService(ds);
  });

  describe('generate', () => {
    it('produces an 8-char code from an unambiguous uppercase alphabet (no O/0/I/1/L)', () => {
      for (let i = 0; i < 50; i++) {
        expect(service.generate()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      }
    });

    it('does not collide across many generations', () => {
      const codes = new Set(Array.from({ length: 200 }, () => service.generate()));
      expect(codes.size).toBe(200);
    });
  });

  describe('normalize', () => {
    it('uppercases and strips spaces and dashes so a hand-typed code matches', () => {
      expect(service.normalize('  ab cd-12 34 ')).toBe('ABCD1234');
    });

    it('returns "" for nullish input', () => {
      expect(service.normalize(undefined as unknown as string)).toBe('');
      expect(service.normalize(null as unknown as string)).toBe('');
    });
  });

  describe('resolveClientByCode', () => {
    it('returns the clientId for a known code, matched on the normalized value', async () => {
      query.mockResolvedValueOnce([{ id: 'c1' }]);

      const clientId = await service.resolveClientByCode('  ab cd-12 34 ');

      expect(clientId).toBe('c1');
      const [, params] = query.mock.calls[0];
      expect(params[0]).toBe('ABCD1234');
    });

    it('returns null when no client owns the code', async () => {
      query.mockResolvedValueOnce([]);
      expect(await service.resolveClientByCode('ZZZZZZZZ')).toBeNull();
    });

    it('returns null without querying for an empty code', async () => {
      expect(await service.resolveClientByCode('   ')).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });

    it('fails closed to null when the lookup throws', async () => {
      query.mockRejectedValueOnce(new Error('db down'));
      expect(await service.resolveClientByCode('ABCD1234')).toBeNull();
    });
  });
});
