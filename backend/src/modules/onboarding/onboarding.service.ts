import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Client } from '../clients/client.entity';
import { CanalEntrada } from '../canal-entrada/canal-entrada.entity';
import { User } from '../users/user.entity';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { VerifyChannelDto } from './dto/verify-channel.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';

/** Ordered list of onboarding steps — used for >= comparisons. */
const STEP_ORDER = [
  'client_created',
  'channel_configured',
  'channel_verified',
  'admin_created',
  'completed',
] as const;

type OnboardingStep = (typeof STEP_ORDER)[number];

function stepIndex(step: string): number {
  return STEP_ORDER.indexOf(step as OnboardingStep);
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,

    @InjectRepository(CanalEntrada)
    private readonly canalRepo: Repository<CanalEntrada>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly dataSource: DataSource,
  ) {}

  // ── Step helpers ─────────────────────────────────────────────────────────

  private async loadActiveClient(clientId: string): Promise<Client> {
    const client = await this.clientRepo.findOneBy({ id: clientId });
    if (!client) {
      throw new NotFoundException(`Client ${clientId} not found`);
    }
    if (client.status !== 'onboarding') {
      throw new BadRequestException(
        `Client ${clientId} is not in onboarding status (current: ${client.status})`,
      );
    }
    return client;
  }

  private requireStep(client: Client, minStep: OnboardingStep): void {
    if (stepIndex(client.onboarding_step) < stepIndex(minStep)) {
      throw new BadRequestException(
        `Onboarding step '${minStep}' is required before this action. ` +
          `Current step: '${client.onboarding_step}'.`,
      );
    }
  }

  // ── Step 2: Configure Channel ─────────────────────────────────────────────

  async configureChannel(
    clientId: string,
    dto: ConfigureChannelDto,
  ): Promise<CanalEntrada> {
    const client = await this.loadActiveClient(clientId);

    // Any step from 'client_created' onward is valid (allows re-running if needed)
    if (client.onboarding_step === 'completed') {
      throw new BadRequestException('Onboarding is already completed.');
    }

    const canal = this.canalRepo.create({
      nombre: dto.nombre,
      tipo: dto.tipo,
      config: dto.config ?? null,
      client_id: clientId,
      is_active: false,
    });

    const savedCanal = await this.canalRepo.save(canal);

    // Advance step only if not already past this point
    if (stepIndex(client.onboarding_step) < stepIndex('channel_configured')) {
      await this.clientRepo.update(clientId, {
        onboarding_step: 'channel_configured',
      });
    }

    this.logger.log(
      `Channel configured [clientId=${clientId}, channelId=${savedCanal.id}, tipo=${dto.tipo}]`,
    );

    return savedCanal;
  }

  // ── Step 3: Verify Channel ────────────────────────────────────────────────

  async verifyChannel(
    clientId: string,
    canalEntradaId: string,
    dto: VerifyChannelDto,
  ): Promise<{ verified: boolean; channel: Partial<CanalEntrada> }> {
    const client = await this.loadActiveClient(clientId);
    this.requireStep(client, 'channel_configured');

    const channel = await this.canalRepo.findOneBy({ id: canalEntradaId });
    if (!channel) {
      throw new NotFoundException(`Channel ${canalEntradaId} not found`);
    }
    if (channel.client_id !== clientId) {
      throw new BadRequestException(
        'Channel does not belong to this client.',
      );
    }

    // ── HMAC verification ──────────────────────────────────────────────────
    const secret = channel.config?.webhook_secret as string | undefined;
    if (!secret) {
      throw new BadRequestException(
        'Channel has no webhook_secret configured in config. ' +
          'Add { "webhook_secret": "..." } to the channel config.',
      );
    }

    const testPayload =
      dto.test_payload ??
      JSON.stringify({ test: true, timestamp: new Date().toISOString() });

    const expectedSignature = this.buildHmac(secret, testPayload);

    if (dto.test_signature) {
      // Full verification mode: Compare against caller's provided signature
      const sigBuffer = Buffer.from(expectedSignature);
      const callerBuffer = Buffer.from(dto.test_signature);

      // Check buffer length to prevent timingSafeEqual crash
      if (sigBuffer.length !== callerBuffer.length) {
        throw new BadRequestException(
          'Signature verification failed. Check your webhook_secret.',
        );
      }

      const isValid = crypto.timingSafeEqual(sigBuffer, callerBuffer);
      if (!isValid) {
        throw new BadRequestException(
          'Signature verification failed. Check your webhook_secret.',
        );
      }
    } else {
      // Self-test mode: Verify HMAC produces valid format output
      // Proves: (a) secret is stored, (b) crypto is functioning correctly
      if (
        !expectedSignature.startsWith('sha256=') ||
        expectedSignature.length !== 71
      ) {
        throw new InternalServerErrorException(
          'HMAC self-test produced invalid output',
        );
      }
    }

    // ── Mark channel active & advance onboarding step ──────────────────────
    await this.canalRepo.update({ id: channel.id }, { is_active: true });

    if (stepIndex(client.onboarding_step) < stepIndex('channel_verified')) {
      await this.clientRepo.update(clientId, {
        onboarding_step: 'channel_verified',
      });
    }

    this.logger.log(
      `Channel verified [clientId=${clientId}, channelId=${channel.id}, is_active=true]`,
    );

    return {
      verified: true,
      channel: {
        id: channel.id,
        nombre: channel.nombre,
        tipo: channel.tipo,
        is_active: true,
      },
    };
  }

  // ── Step 4: Create Admin User ─────────────────────────────────────────────

  async createAdminUser(
    clientId: string,
    dto: CreateAdminUserDto,
  ): Promise<Omit<User, 'password'>> {
    const client = await this.loadActiveClient(clientId);
    this.requireStep(client, 'channel_verified');

    // Per-tenant email uniqueness check
    const existing = await this.userRepo.findOneBy({
      email: dto.email,
      client_id: clientId,
    });
    if (existing) {
      throw new ConflictException(
        `A user with email '${dto.email}' already exists for this client.`,
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = this.userRepo.create({
      email: dto.email,
      password: hashedPassword,
      full_name: dto.full_name ?? null,
      role: 'admin_cliente',
      client_id: clientId,
    });

    const saved = await this.userRepo.save(user);

    if (stepIndex(client.onboarding_step) < stepIndex('admin_created')) {
      await this.clientRepo.update(clientId, {
        onboarding_step: 'admin_created',
      });
    }

    this.logger.log(
      `Admin user created [clientId=${clientId}, userId=${saved.id}, email=${saved.email}]`,
    );

    // Return without password
    const { password: _pwd, ...safeUser } = saved as User & { password: string };
    return safeUser;
  }

  // ── Step 5: Complete Onboarding ───────────────────────────────────────────

  async completeOnboarding(clientId: string): Promise<Client> {
    // Load full relations for validation
    const client = await this.clientRepo.findOne({
      where: { id: clientId },
      relations: ['canales', 'users'],
    });

    if (!client) {
      throw new NotFoundException(`Client ${clientId} not found`);
    }
    if (client.status !== 'onboarding') {
      throw new BadRequestException(
        `Client is not in onboarding status (current: ${client.status})`,
      );
    }

    // ── Validate all prerequisites ─────────────────────────────────────────
    const activeChannels = (client.canales ?? []).filter((c) => c.is_active);
    const adminUsers = (client.users ?? []).filter(
      (u) => u.role === 'admin_cliente',
    );

    const errors: string[] = [];

    if (activeChannels.length === 0) {
      errors.push('At least one verified (active) channel is required.');
    }
    if (adminUsers.length === 0) {
      errors.push('At least one admin_cliente user is required.');
    }
    if (client.onboarding_step !== 'admin_created') {
      errors.push(
        `Onboarding step must be 'admin_created' before completing ` +
          `(current: '${client.onboarding_step}').`,
      );
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Cannot complete onboarding — prerequisites not met.',
        errors,
      });
    }

    const startTime = Date.now();

    // ── Atomically mark client as active ───────────────────────────────────
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Client, { id: clientId }, {
        status: 'active',
        onboarding_step: 'completed',
        onboarding_completed_at: new Date(),
      });
    });

    const duration = Date.now() - startTime;
    this.logger.log(
      `Onboarding completed [clientId=${clientId}, duration=${duration}ms]`,
    );

    // Return updated client with relations
    return this.clientRepo.findOne({
      where: { id: clientId },
      relations: ['canales', 'users'],
    }) as Promise<Client>;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildHmac(secret: string, payload: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  }
}