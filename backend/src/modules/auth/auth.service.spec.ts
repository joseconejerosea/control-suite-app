/// <reference types="jest" />
/**
 * Unit tests for AuthService.login multi-tenant disambiguation.
 *
 * Context: users.email is unique only per-tenant (composite index
 * (client_id, email), migration 009). The same email can therefore exist in
 * several agencies. The old login did findOne({ where: { email } }) and
 * resolved to an ARBITRARY tenant → wrong client_id in the JWT → cross-tenant
 * data shown. These tests pin the new behaviour:
 *   - password is verified against every candidate (never reveal tenant
 *     membership pre-auth),
 *   - exactly one match → issue tokens,
 *   - several matches (same email + password across tenants) → ask the caller
 *     to pick an agency, then resolve with the chosen tenantId.
 */
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserRole } from '../../common/enums/user-role.enum';

const PASSWORD = 'secret-password';
const OTHER_PASSWORD = 'different-password';

let hash: string;
let otherHash: string;

beforeAll(async () => {
  hash = await bcrypt.hash(PASSWORD, 4); // low cost: unit speed, not prod
  otherHash = await bcrypt.hash(OTHER_PASSWORD, 4);
});

function makeService(opts: {
  candidates: any[];
  clients?: any[];
}) {
  const userRepo = {
    find: jest.fn().mockResolvedValue(opts.candidates),
    findOne: jest.fn(),
  };
  const serviceLeadTenantRepo = {};
  const clientRepo = {
    find: jest.fn().mockResolvedValue(opts.clients ?? []),
  };
  const jwtService = { sign: jest.fn().mockReturnValue('signed-token') };
  const configService = { get: jest.fn().mockReturnValue('refresh-secret') };

  const service = new AuthService(
    userRepo as any,
    serviceLeadTenantRepo as any,
    clientRepo as any,
    jwtService as any,
    configService as any,
  );
  return { service, userRepo, clientRepo, jwtService };
}

describe('AuthService.login — multi-tenant disambiguation', () => {
  it('issues tokens when a single account matches email + password', async () => {
    const { service, jwtService } = makeService({
      candidates: [{ id: 'u1', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-A' }],
    });

    const res = await service.login({ email: 'a@x.com', password: PASSWORD } as any);

    expect(res).toHaveProperty('accessToken', 'signed-token');
    expect(res).toHaveProperty('refreshToken');
    // access-token payload carries the right tenant
    expect(jwtService.sign.mock.calls[0][0]).toMatchObject({ client_id: 'tenant-A' });
  });

  it('rejects with 401 when the password matches no account', async () => {
    const { service } = makeService({
      candidates: [{ id: 'u1', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-A' }],
    });

    await expect(
      service.login({ email: 'a@x.com', password: 'wrong-password' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('auto-resolves to the matching account when the email collides but passwords differ', async () => {
    const { service, jwtService } = makeService({
      candidates: [
        { id: 'u1', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-A' },
        { id: 'u2', email: 'a@x.com', password: otherHash, role: UserRole.MANAGER, client_id: 'tenant-B' },
      ],
    });

    const res = await service.login({ email: 'a@x.com', password: OTHER_PASSWORD } as any);

    expect(res).toHaveProperty('accessToken');
    expect((res as any).needsTenant).toBeUndefined();
    expect(jwtService.sign.mock.calls[0][0]).toMatchObject({ client_id: 'tenant-B' });
  });

  it('asks for agency selection when email + password collide across tenants', async () => {
    const { service, jwtService } = makeService({
      candidates: [
        { id: 'u1', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-A' },
        { id: 'u2', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-B' },
      ],
      clients: [
        { id: 'tenant-A', nombre: 'Agencia A' },
        { id: 'tenant-B', nombre: 'Agencia B' },
      ],
    });

    const res: any = await service.login({ email: 'a@x.com', password: PASSWORD } as any);

    expect(res.needsTenant).toBe(true);
    expect(res.tenants).toEqual(
      expect.arrayContaining([
        { id: 'tenant-A', nombre: 'Agencia A' },
        { id: 'tenant-B', nombre: 'Agencia B' },
      ]),
    );
    // No tokens leaked in the disambiguation step
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('resolves to the chosen tenant when tenantId is supplied', async () => {
    const { service, jwtService } = makeService({
      candidates: [
        { id: 'u1', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-A' },
        { id: 'u2', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-B' },
      ],
    });

    const res: any = await service.login({ email: 'a@x.com', password: PASSWORD, tenantId: 'tenant-B' } as any);

    expect(res).toHaveProperty('accessToken');
    expect(jwtService.sign.mock.calls[0][0]).toMatchObject({ client_id: 'tenant-B' });
  });

  it('rejects when the supplied tenantId is not among the password-matched accounts', async () => {
    const { service } = makeService({
      candidates: [
        { id: 'u1', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-A' },
        { id: 'u2', email: 'a@x.com', password: hash, role: UserRole.MANAGER, client_id: 'tenant-B' },
      ],
    });

    await expect(
      service.login({ email: 'a@x.com', password: PASSWORD, tenantId: 'tenant-OTHER' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
