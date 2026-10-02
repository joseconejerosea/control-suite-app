/// <reference types="jest" />
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { OnboardingService } from './onboarding.service';
import { Client } from '../clients/client.entity';
import { User } from '../users/user.entity';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UserRole } from '../../common/enums/user-role.enum';

/**
 * Onboarding — single global WhatsApp number model.
 * Flow: create client -> create admin -> activate. No channel configuration.
 */
describe('OnboardingService', () => {
  const CLIENT_ID = 'client-1';

  let service: OnboardingService;
  let clientRepo: { findOneBy: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let userRepo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: DataSource;
  let txUpdate: jest.Mock;

  beforeEach(() => {
    clientRepo = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    userRepo = {
      findOneBy: jest.fn(),
      create: jest.fn((u: Partial<User>) => u),
      save: jest.fn((u: Partial<User>) => Promise.resolve({ ...u, id: 'user-1' })),
    };
    txUpdate = jest.fn().mockResolvedValue(undefined);
    dataSource = {
      transaction: jest.fn(async (fn: (m: { update: jest.Mock }) => unknown) => fn({ update: txUpdate })),
    } as unknown as DataSource;

    service = new OnboardingService(
      clientRepo as unknown as Repository<Client>,
      userRepo as unknown as Repository<User>,
      dataSource,
    );
  });

  const onboardingClient = (step: string): Client =>
    ({ id: CLIENT_ID, status: 'onboarding', onboarding_step: step } as Client);

  describe('createAdminUser', () => {
    const dto: CreateAdminUserDto = { email: 'admin@x.com', password: 'password123' } as CreateAdminUserDto;

    it('creates a Manager and advances the step to admin_created (no channel needed)', async () => {
      clientRepo.findOneBy.mockResolvedValue(onboardingClient('client_created'));
      userRepo.findOneBy.mockResolvedValue(null);

      const saved = await service.createAdminUser(CLIENT_ID, dto);

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.MANAGER, client_id: CLIENT_ID }),
      );
      expect(clientRepo.update).toHaveBeenCalledWith(CLIENT_ID, { onboarding_step: 'admin_created' });
      expect((saved as { password?: string }).password).toBeUndefined();
    });

    it('rejects a duplicate email for the same client', async () => {
      clientRepo.findOneBy.mockResolvedValue(onboardingClient('client_created'));
      userRepo.findOneBy.mockResolvedValue({ id: 'existing' });

      await expect(service.createAdminUser(CLIENT_ID, dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('completeOnboarding', () => {
    it('activates the client with an admin at admin_created — no active channel required', async () => {
      clientRepo.findOne.mockResolvedValue({
        id: CLIENT_ID,
        status: 'onboarding',
        onboarding_step: 'admin_created',
        users: [{ role: UserRole.MANAGER }],
      });

      await service.completeOnboarding(CLIENT_ID);

      expect(txUpdate).toHaveBeenCalledWith(
        Client,
        { id: CLIENT_ID },
        expect.objectContaining({ status: 'active', onboarding_step: 'completed' }),
      );
    });

    it('rejects when there is no admin_cliente user', async () => {
      clientRepo.findOne.mockResolvedValue({
        id: CLIENT_ID,
        status: 'onboarding',
        onboarding_step: 'admin_created',
        users: [],
      });

      const err = await service.completeOnboarding(CLIENT_ID).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(txUpdate).not.toHaveBeenCalled();
    });
  });
});
