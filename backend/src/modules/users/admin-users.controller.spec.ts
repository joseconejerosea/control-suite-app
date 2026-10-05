/// <reference types="jest" />
/**
 * Unit tests for AdminUsersController — platform-email guard.
 *
 * Un email que ya pertenece a un usuario platform-level (super_admin/service_lead,
 * client_id IS NULL) no puede reusarse como miembro de una agencia: evita la
 * colisión email+password cross-tipo que dejaría al super_admin sin login global.
 */
import { BadRequestException } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { UserRole } from '../../common/enums/user-role.enum';

const SUPERADMIN = { sub: 'sa', role: UserRole.SUPERADMIN, client_id: null } as any;

function makeController(findOneImpl: jest.Mock) {
  const userRepo = {
    findOne: findOneImpl,
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'new-id', ...x })),
  };
  return { controller: new AdminUsersController(userRepo as any), userRepo };
}

describe('AdminUsersController — platform-email guard', () => {
  it('rejects create when the email belongs to a platform user (client_id NULL)', async () => {
    const findOne = jest
      .fn()
      // assertEmailNotPlatform → existe un platform user con ese email
      .mockResolvedValueOnce({ id: 'sa-1', email: 'super@x.com', client_id: null });
    const { controller, userRepo } = makeController(findOne);

    await expect(
      controller.create(SUPERADMIN, {
        client_id: 'tenant-A',
        email: 'super@x.com',
        password: 'secret-password',
        role: UserRole.MANAGER,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('creates the user when the email is NOT a platform email', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null) // no platform user
      .mockResolvedValueOnce(null); // no existing per-tenant user
    const { controller, userRepo } = makeController(findOne);

    const res: any = await controller.create(SUPERADMIN, {
      client_id: 'tenant-A',
      email: 'nuevo@x.com',
      password: 'secret-password',
      role: UserRole.MANAGER,
    } as any);

    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(res).not.toHaveProperty('password'); // password nunca se devuelve
    expect(res).toMatchObject({ email: 'nuevo@x.com', client_id: 'tenant-A' });
  });

  it('rejects update when changing the email to a platform email', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({ id: 'u1', email: 'viejo@x.com', client_id: 'tenant-A' }) // target
      .mockResolvedValueOnce({ id: 'sa-1', email: 'super@x.com', client_id: null }); // platform collision
    const { controller, userRepo } = makeController(findOne);

    await expect(
      controller.update(SUPERADMIN, 'u1', { email: 'super@x.com' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userRepo.save).not.toHaveBeenCalled();
  });
});
