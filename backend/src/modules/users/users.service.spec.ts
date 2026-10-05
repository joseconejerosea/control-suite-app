/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { UserService } from './users.service';

describe('UserService.create — platform-email guard', () => {
  it('rejects creating a tenant user with a platform email', async () => {
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'sa', email: 'super@x.com', client_id: null }),
      create: jest.fn(),
      save: jest.fn(),
    } as any;
    const service = new UserService(userRepo);

    await expect(
      service.create({ email: 'super@x.com', password: 'secret-password', client_id: 'tenant-A' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('creates when the email is not a platform email', async () => {
    const userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'u1', ...x })),
    } as any;
    const service = new UserService(userRepo);

    const res = await service.create({
      email: 'nuevo@x.com',
      password: 'secret-password',
      client_id: 'tenant-A',
    } as any);

    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ email: 'nuevo@x.com', client_id: 'tenant-A' });
  });
});
