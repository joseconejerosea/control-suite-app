import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Client } from '../clients/client.entity';
import { User } from '../users/user.entity';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UserRole } from '../../common/enums/user-role.enum';

/**
 * Onboarding — single global WhatsApp number model.
 *
 * A tenant no longer configures channels during onboarding:
 *  - WhatsApp works for every tenant automatically (the bot routes by SENDER and the
 *    tenant hands its affiliation code to its staff).
 *  - Email is connected later by the Manager (Gmail OAuth in client/config), not here.
 *  - Generic REST webhooks (rare) are added later via the canal-entrada endpoints.
 *
 * So onboarding is just: create client (gets an affiliation code) → create admin →
 * activate.
 */
const STEP_ORDER = ['client_created', 'admin_created', 'completed'] as const;
type OnboardingStep = (typeof STEP_ORDER)[number];

function stepIndex(step: string): number {
  return STEP_ORDER.indexOf(step as OnboardingStep);
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  private async loadActiveClient(clientId: string): Promise<Client> {
    const client = await this.clientRepo.findOneBy({ id: clientId });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);
    if (client.status !== 'onboarding') {
      throw new BadRequestException(
        `Client ${clientId} is not in onboarding status (current: ${client.status})`,
      );
    }
    return client;
  }

  // ── Step 2: Create Admin User ─────────────────────────────────────────────

  async createAdminUser(clientId: string, dto: CreateAdminUserDto): Promise<Omit<User, 'password'>> {
    const client = await this.loadActiveClient(clientId);
    if (client.onboarding_step === 'completed') {
      throw new BadRequestException('Onboarding is already completed.');
    }

    const existing = await this.userRepo.findOneBy({ email: dto.email, client_id: clientId });
    if (existing) throw new ConflictException(`User '${dto.email}' already exists for this client.`);

    const user = this.userRepo.create({
      email: dto.email,
      password: await bcrypt.hash(dto.password, 12),
      full_name: dto.full_name ?? null,
      role: UserRole.MANAGER,
      client_id: clientId,
    });
    const saved = await this.userRepo.save(user);

    if (stepIndex(client.onboarding_step) < stepIndex('admin_created')) {
      await this.clientRepo.update(clientId, { onboarding_step: 'admin_created' });
    }

    this.logger.log(`Admin user created [clientId=${clientId}, email=${saved.email}]`);
    const { password: _pwd, ...safeUser } = saved as User & { password: string };
    return safeUser;
  }

  // ── Step 3: Complete Onboarding ───────────────────────────────────────────

  async completeOnboarding(clientId: string): Promise<Client> {
    const client = await this.clientRepo.findOne({
      where: { id: clientId },
      relations: ['users'],
    });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);
    if (client.status !== 'onboarding') throw new BadRequestException('Client is not in onboarding status.');

    const errors: string[] = [];
    if (!(client.users ?? []).some((u) => u.role === UserRole.MANAGER)) {
      errors.push('At least one admin_cliente user required.');
    }
    if (client.onboarding_step !== 'admin_created') {
      errors.push(`Step must be 'admin_created' (current: '${client.onboarding_step}').`);
    }

    if (errors.length > 0) throw new BadRequestException({ message: 'Cannot complete onboarding.', errors });

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Client, { id: clientId }, {
        status: 'active',
        onboarding_step: 'completed',
        onboarding_completed_at: new Date(),
      });
    });

    this.logger.log(`Onboarding completed [clientId=${clientId}]`);
    return this.clientRepo.findOne({
      where: { id: clientId },
      relations: ['users'],
    }) as Promise<Client>;
  }
}
