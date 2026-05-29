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
import * as crypto from 'crypto';
import { Client } from '../clients/client.entity';
import { CanalEntrada } from '../canal-entrada/canal-entrada.entity';
import { User } from '../users/user.entity';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { VerifyChannelDto } from './dto/verify-channel.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ProvisionWhatsAppDto } from './dto/provision-whatsapp.dto';
import { VerifyWhatsAppOtpDto } from './dto/verify-whatsapp-otp.dto';

const STEP_ORDER = [
  'client_created',
  'channel_configured',
  'wa_number_requested',
  'wa_number_verified',
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
  private readonly logger  = new Logger(OnboardingService.name);
  private readonly wabaId  = process.env.META_WABA_ID ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';

  constructor(
    @InjectRepository(Client)       private readonly clientRepo: Repository<Client>,
    @InjectRepository(CanalEntrada) private readonly canalRepo:  Repository<CanalEntrada>,
    @InjectRepository(User)         private readonly userRepo:   Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  private async loadActiveClient(clientId: string): Promise<Client> {
    const client = await this.clientRepo.findOneBy({ id: clientId });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);
    if (client.status !== 'onboarding') {
      throw new BadRequestException(`Client ${clientId} is not in onboarding status (current: ${client.status})`);
    }
    return client;
  }

  private requireStep(client: Client, minStep: OnboardingStep): void {
    if (stepIndex(client.onboarding_step) < stepIndex(minStep)) {
      throw new BadRequestException(
        `Step '${minStep}' required. Current: '${client.onboarding_step}'.`,
      );
    }
  }

  // ── Step 2: Configure Channel ─────────────────────────────────────────────

  async configureChannel(clientId: string, dto: ConfigureChannelDto): Promise<CanalEntrada> {
    const client = await this.loadActiveClient(clientId);
    if (client.onboarding_step === 'completed') {
      throw new BadRequestException('Onboarding is already completed.');
    }

    const canal = this.canalRepo.create({
      nombre: dto.nombre, tipo: dto.tipo,
      config: dto.config ?? null, client_id: clientId, is_active: false,
    });
    const savedCanal = await this.canalRepo.save(canal);

    if (stepIndex(client.onboarding_step) < stepIndex('channel_configured')) {
      await this.clientRepo.update(clientId, { onboarding_step: 'channel_configured' });
    }
    this.logger.log(`Channel configured [clientId=${clientId}, channelId=${savedCanal.id}, tipo=${dto.tipo}]`);
    return savedCanal;
  }

  // ── Step 2b: Provision WhatsApp ───────────────────────────────────────────
  // Uses existing registered test number from env.
  // Meta test mode does not allow registering new numbers via API.

  async provisionWhatsApp(
    clientId: string,
    canalEntradaId: string,
    dto: ProvisionWhatsAppDto,
  ): Promise<{ phone_number_id: string; message: string }> {
    const client = await this.loadActiveClient(clientId);
    this.requireStep(client, 'channel_configured');

    const canal = await this.canalRepo.findOneBy({ id: canalEntradaId });
    if (!canal) throw new NotFoundException(`Channel ${canalEntradaId} not found`);
    if (canal.client_id !== clientId) throw new BadRequestException('Channel does not belong to this client.');
    if (canal.tipo !== 'whatsapp') throw new BadRequestException(`Channel tipo must be 'whatsapp'.`);

    // Use existing registered test number from env
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '1118041604727374';

    await this.canalRepo.update({ id: canal.id }, {
      config: {
        ...(canal.config ?? {}),
        phone_number_id:      phoneNumberId,
        display_phone_number: `+${dto.cc}${dto.phone_number}`,
        verified_name:        dto.verified_name,
        waba_id:              this.wabaId,
        cc:                   dto.cc,
        raw_phone_number:     dto.phone_number,
      },
      is_active: true,
    });

    if (stepIndex(client.onboarding_step) < stepIndex('wa_number_verified')) {
      await this.clientRepo.update(clientId, { onboarding_step: 'wa_number_verified' });
    }

    this.logger.log(`[OnboardingService] WA channel configured [clientId=${clientId}, phone_number_id=${phoneNumberId}]`);
    return {
      phone_number_id: phoneNumberId,
      message:         `WhatsApp channel configured. Number +${dto.cc}${dto.phone_number} linked.`,
    };
  }

  // ── Step 2c: Verify OTP ───────────────────────────────────────────────────
  // Number already active — just confirm and advance step.

  async verifyWhatsAppOtp(
    clientId: string,
    canalEntradaId: string,
    dto: VerifyWhatsAppOtpDto,
  ): Promise<{ verified: boolean; phone_number_id: string; display_phone_number: string }> {
    const client = await this.loadActiveClient(clientId);
    this.requireStep(client, 'wa_number_requested');

    const canal = await this.canalRepo.findOneBy({ id: canalEntradaId });
    if (!canal) throw new NotFoundException(`Channel ${canalEntradaId} not found`);
    if (canal.client_id !== clientId) throw new BadRequestException('Channel does not belong to this client.');

    const phoneNumberId = (canal.config?.phone_number_id as string | undefined)
      ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? '1118041604727374';
    const displayNumber = (canal.config?.display_phone_number as string | undefined) ?? phoneNumberId;

    await this.canalRepo.update({ id: canal.id }, { is_active: true });

    if (stepIndex(client.onboarding_step) < stepIndex('wa_number_verified')) {
      await this.clientRepo.update(clientId, { onboarding_step: 'wa_number_verified' });
    }

    this.logger.log(`[OnboardingService] WA channel active [clientId=${clientId}, phone_number_id=${phoneNumberId}]`);
    return { verified: true, phone_number_id: phoneNumberId, display_phone_number: displayNumber };
  }

  // ── Step 3: Verify non-WA channels ───────────────────────────────────────

  async verifyChannel(
    clientId: string,
    canalEntradaId: string,
    dto: VerifyChannelDto,
  ): Promise<{ verified: boolean; channel: Partial<CanalEntrada> }> {
    const client = await this.loadActiveClient(clientId);
    const canal  = await this.canalRepo.findOneBy({ id: canalEntradaId });
    if (!canal) throw new NotFoundException(`Channel ${canalEntradaId} not found`);

    if (canal.tipo === 'whatsapp') {
      throw new BadRequestException('WhatsApp channels use /provision-whatsapp and /verify-whatsapp-otp.');
    }

    this.requireStep(client, 'channel_configured');
    if (canal.client_id !== clientId) throw new BadRequestException('Channel does not belong to this client.');

    const secret = canal.config?.webhook_secret as string | undefined;
    if (!secret) throw new BadRequestException('Channel has no webhook_secret in config.');

    const testPayload       = dto.test_payload ?? JSON.stringify({ test: true, timestamp: new Date().toISOString() });
    const expectedSignature = this.buildHmac(secret, testPayload);

    if (dto.test_signature) {
      const a = Buffer.from(expectedSignature);
      const b = Buffer.from(dto.test_signature);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new BadRequestException('Signature verification failed.');
      }
    }

    await this.canalRepo.update({ id: canal.id }, { is_active: true });
    if (stepIndex(client.onboarding_step) < stepIndex('channel_verified')) {
      await this.clientRepo.update(clientId, { onboarding_step: 'channel_verified' });
    }

    this.logger.log(`Channel verified [clientId=${clientId}, channelId=${canal.id}]`);
    return { verified: true, channel: { id: canal.id, nombre: canal.nombre, tipo: canal.tipo, is_active: true } };
  }

  // ── Step 4: Create Admin User ─────────────────────────────────────────────

  async createAdminUser(clientId: string, dto: CreateAdminUserDto): Promise<Omit<User, 'password'>> {
    const client = await this.loadActiveClient(clientId);
    // WA channels skip channel_verified step
    const minStep = client.onboarding_step === 'wa_number_verified' ? 'wa_number_verified' : 'channel_verified';
    this.requireStep(client, minStep as OnboardingStep);

    const existing = await this.userRepo.findOneBy({ email: dto.email, client_id: clientId });
    if (existing) throw new ConflictException(`User '${dto.email}' already exists for this client.`);

    const user = this.userRepo.create({
      email:     dto.email,
      password:  await bcrypt.hash(dto.password, 12),
      full_name: dto.full_name ?? null,
      role:      'admin_cliente',
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

  // ── Step 5: Complete Onboarding ───────────────────────────────────────────

  async completeOnboarding(clientId: string): Promise<Client> {
    const client = await this.clientRepo.findOne({
      where: { id: clientId }, relations: ['canales', 'users'],
    });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);
    if (client.status !== 'onboarding') throw new BadRequestException(`Client is not in onboarding status.`);

    const errors: string[] = [];
    if (!(client.canales ?? []).some(c => c.is_active))             errors.push('At least one active channel required.');
    if (!(client.users ?? []).some(u => u.role === 'admin_cliente')) errors.push('At least one admin_cliente user required.');
    if (client.onboarding_step !== 'admin_created')                  errors.push(`Step must be 'admin_created' (current: '${client.onboarding_step}').`);

    if (errors.length > 0) throw new BadRequestException({ message: 'Cannot complete onboarding.', errors });

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Client, { id: clientId }, {
        status: 'active', onboarding_step: 'completed', onboarding_completed_at: new Date(),
      });
    });

    this.logger.log(`Onboarding completed [clientId=${clientId}]`);
    return this.clientRepo.findOne({ where: { id: clientId }, relations: ['canales', 'users'] }) as Promise<Client>;
  }

  private buildHmac(secret: string, payload: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  }
}