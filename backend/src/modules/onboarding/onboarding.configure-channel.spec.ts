/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { OnboardingService } from './onboarding.service';
import { Client } from '../clients/client.entity';
import { CanalEntrada } from '../canal-entrada/canal-entrada.entity';
import { User } from '../users/user.entity';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { UserRole } from '../../common/enums/user-role.enum';

/**
 * configureChannel — single global WhatsApp number model.
 *
 * A WhatsApp channel needs no Meta registration/OTP, so it is marked active on
 * configuration and the onboarding step jumps straight to 'channel_verified'.
 * Other channel types stay inactive at 'channel_configured' until verified.
 */
describe('OnboardingService — configureChannel', () => {
  const CLIENT_ID = 'client-1';
  const CANAL_ID = 'canal-1';

  let service: OnboardingService;
  let clientRepo: { findOneBy: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let canalRepoCtx: { create: jest.Mock; save: jest.Mock };
  let userRepo: Partial<jest.Mocked<Repository<User>>>;
  let dataSource: DataSource;

  beforeEach(() => {
    clientRepo = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    canalRepoCtx = {
      // create() echoes the entity payload; save() returns it with an id.
      create: jest.fn((entity: Partial<CanalEntrada>) => entity),
      save: jest.fn((entity: Partial<CanalEntrada>) =>
        Promise.resolve({ ...entity, id: CANAL_ID }),
      ),
    };
    userRepo = {};

    // tenantManager(ds) falls back to ds.manager when no tenant store is active;
    // ds.manager.getRepository(CanalEntrada) must return our mocked ctx repo.
    dataSource = {
      manager: {
        getRepository: (entity: unknown) =>
          entity === CanalEntrada ? canalRepoCtx : ({} as unknown),
      },
    } as unknown as DataSource;

    service = new OnboardingService(
      clientRepo as unknown as Repository<Client>,
      {} as unknown as Repository<CanalEntrada>,
      userRepo as unknown as Repository<User>,
      dataSource,
    );
  });

  function activeClient(step: string): Client {
    return { id: CLIENT_ID, status: 'onboarding', onboarding_step: step } as Client;
  }

  it('activates a WhatsApp channel and advances the step to channel_verified', async () => {
    clientRepo.findOneBy.mockResolvedValue(activeClient('client_created'));
    const dto: ConfigureChannelDto = { nombre: 'WA', tipo: 'whatsapp' } as ConfigureChannelDto;

    const saved = await service.configureChannel(CLIENT_ID, dto);

    expect(canalRepoCtx.save).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'whatsapp', is_active: true }),
    );
    expect(saved.is_active).toBe(true);
    expect(clientRepo.update).toHaveBeenCalledWith(CLIENT_ID, {
      onboarding_step: 'channel_verified',
    });
  });

  it('leaves an email channel inactive at channel_configured', async () => {
    clientRepo.findOneBy.mockResolvedValue(activeClient('client_created'));
    const dto: ConfigureChannelDto = { nombre: 'Mail', tipo: 'email' } as ConfigureChannelDto;

    const saved = await service.configureChannel(CLIENT_ID, dto);

    expect(canalRepoCtx.save).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'email', is_active: false }),
    );
    expect(saved.is_active).toBe(false);
    expect(clientRepo.update).toHaveBeenCalledWith(CLIENT_ID, {
      onboarding_step: 'channel_configured',
    });
  });

  it('completeOnboarding rejects when a configured channel is still inactive', async () => {
    clientRepo.findOne.mockResolvedValue({
      id: CLIENT_ID,
      status: 'onboarding',
      onboarding_step: 'admin_created',
      canales: [
        { is_active: true, nombre: 'WA' },
        { is_active: false, nombre: 'Mail' }, // unverified email — must block completion
      ],
      users: [{ role: UserRole.MANAGER }],
    } as unknown as Client);

    const err = await service.completeOnboarding(CLIENT_ID).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    // The inactive channel is named in the error so the operator knows what to verify.
    expect(JSON.stringify((err as BadRequestException).getResponse())).toContain('Mail');
  });
});
