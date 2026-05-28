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
import { ProvisionWhatsAppDto } from './dto/provision-whatsapp.dto';
import { VerifyWhatsAppOtpDto } from './dto/verify-whatsapp-otp.dto';

const META_API = 'https://graph.facebook.com/v19.0';

/** Ordered list of onboarding steps — used for >= comparisons. */
const STEP_ORDER = [
  'client_created',
  'channel_configured',
  'wa_number_requested',   // NEW — Meta API called, OTP sent to phone
  'wa_number_verified',    // NEW — OTP confirmed, phone_number_id is live
  'channel_verified',
  'admin_created',
  'completed',
] as const;

type OnboardingStep = (typeof STEP_ORDER)[number];

function stepIndex(step: string): number {
  return STEP_ORDER.indexOf(step as OnboardingStep);
}

// ── Meta API response shapes ──────────────────────────────────────────────────

interface MetaPhoneNumberResponse {
  id: string;                  // phone_number_id
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string;
}

interface MetaErrorResponse {
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  // Meta credentials — read once at startup
  private readonly wabaId      = process.env.META_WABA_ID ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';
  private readonly systemToken = process.env.META_SYSTEM_USER_TOKEN ?? process.env.WHATSAPP_ACCESS_TOKEN ?? '';

  constructor(
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,

    @InjectRepository(CanalEntrada)
    private readonly canalRepo: Repository<CanalEntrada>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly dataSource: DataSource,
  ) {}

  // ── Step helpers ──────────────────────────────────────────────────────────

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

  private requireStep(client: Client, minStep: OnboardingStep): void {
    if (stepIndex(client.onboarding_step) < stepIndex(minStep)) {
      throw new BadRequestException(
        `Onboarding step '${minStep}' is required before this action. ` +
          `Current step: '${client.onboarding_step}'.`,
      );
    }
  }

  private assertMetaCredentials(): void {
    if (!this.wabaId || !this.systemToken) {
      throw new InternalServerErrorException(
        'META_WABA_ID and META_SYSTEM_USER_TOKEN must be set in environment variables ' +
          'before WhatsApp provisioning can run.',
      );
    }
  }

  // ── Private Meta API helpers ──────────────────────────────────────────────

  /**
   * POST /{WABA_ID}/phone_numbers
   * Registers the phone number with the WABA and triggers OTP delivery.
   * Returns the Meta phone_number_id.
   */
  private async metaRegisterPhoneNumber(
    dto: ProvisionWhatsAppDto,
  ): Promise<MetaPhoneNumberResponse> {
    const url  = `${META_API}/${this.wabaId}/phone_numbers`;
    const body = {
      cc:            dto.cc,
      phone_number:  dto.phone_number,
      verified_name: dto.verified_name,
    };

    this.logger.log(
      `[Meta] Registering phone number +${dto.cc}${dto.phone_number} on WABA ${this.wabaId}`,
    );

    const res  = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${this.systemToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as MetaPhoneNumberResponse & MetaErrorResponse;

    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `Meta API error (HTTP ${res.status})`;
      this.logger.error(`[Meta] Register phone failed: ${msg}`);
      throw new BadRequestException(`Meta WhatsApp registration failed: ${msg}`);
    }

    if (!data.id) {
      throw new InternalServerErrorException(
        'Meta API returned success but no phone_number_id. Contact support.',
      );
    }

    return data;
  }

  /**
   * POST /{phone_number_id}/request_code
   * Asks Meta to (re)send the OTP to the registered phone number.
   */
  private async metaRequestOtp(
    phoneNumberId: string,
    codeMethod: 'SMS' | 'VOICE',
  ): Promise<void> {
    const url  = `${META_API}/${phoneNumberId}/request_code`;
    const body = { code_method: codeMethod, language: 'es' };

    this.logger.log(
      `[Meta] Requesting OTP via ${codeMethod} for phone_number_id=${phoneNumberId}`,
    );

    const res  = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${this.systemToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as MetaErrorResponse & { success?: boolean };

    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `Meta API error (HTTP ${res.status})`;
      this.logger.error(`[Meta] Request OTP failed: ${msg}`);
      throw new BadRequestException(`Meta OTP request failed: ${msg}`);
    }
  }

  /**
   * POST /{phone_number_id}/verify_code
   * Validates the 6-digit OTP entered by the admin.
   * On success, the number is live and ready to send/receive messages.
   */
  private async metaVerifyOtp(
    phoneNumberId: string,
    code: string,
  ): Promise<void> {
    const url  = `${META_API}/${phoneNumberId}/verify_code`;
    const body = { code };

    this.logger.log(
      `[Meta] Verifying OTP for phone_number_id=${phoneNumberId}`,
    );

    const res  = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${this.systemToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as MetaErrorResponse & { success?: boolean };

    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `Meta API error (HTTP ${res.status})`;
      this.logger.error(`[Meta] Verify OTP failed: ${msg}`);
      // Surface a clear user-facing error — wrong code is a 400, not a 500
      throw new BadRequestException(`OTP verification failed: ${msg}`);
    }
  }

  // ── Step 2: Configure Channel ─────────────────────────────────────────────

  async configureChannel(
    clientId: string,
    dto: ConfigureChannelDto,
  ): Promise<CanalEntrada> {
    const client = await this.loadActiveClient(clientId);

    if (client.onboarding_step === 'completed') {
      throw new BadRequestException('Onboarding is already completed.');
    }

    const canal = this.canalRepo.create({
      nombre:    dto.nombre,
      tipo:      dto.tipo,
      config:    dto.config ?? null,
      client_id: clientId,
      is_active: false,
    });

    const savedCanal = await this.canalRepo.save(canal);

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

  // ── Step 2b: Provision WhatsApp Number (Meta API) ─────────────────────────
  //
  // Called ONLY when tipo='whatsapp'.  Registers the client's phone number
  // with the Control Suite WABA and triggers OTP delivery via SMS or voice.
  //
  // After this step:
  //   canal_entrada.config = {
  //     phone_number_id:      "...",   ← used to route incoming webhooks
  //     display_phone_number: "+56 9 ...",
  //     verified_name:        "Agency Name",
  //     waba_id:              "...",
  //     cc:                   "56",
  //     raw_phone_number:     "912345678",
  //   }
  //
  // The phone is NOT yet active — admin must verify OTP next.

  async provisionWhatsApp(
    clientId: string,
    canalEntradaId: string,
    dto: ProvisionWhatsAppDto,
  ): Promise<{ phone_number_id: string; message: string }> {
    this.assertMetaCredentials();

    const client = await this.loadActiveClient(clientId);
    this.requireStep(client, 'channel_configured');

    const canal = await this.canalRepo.findOneBy({ id: canalEntradaId });
    if (!canal) throw new NotFoundException(`Channel ${canalEntradaId} not found`);
    if (canal.client_id !== clientId) {
      throw new BadRequestException('Channel does not belong to this client.');
    }
    if (canal.tipo !== 'whatsapp') {
      throw new BadRequestException(
        `Channel tipo is '${canal.tipo}'. WhatsApp provisioning only applies to tipo='whatsapp'.`,
      );
    }

    // ── 1. Register with Meta — triggers OTP ──────────────────────────────
    const metaRes = await this.metaRegisterPhoneNumber(dto);

    // ── 2. Explicitly request the OTP (some accounts require this separately)
    await this.metaRequestOtp(metaRes.id, dto.code_method);

    // ── 3. Persist phone_number_id in canal config ─────────────────────────
    const updatedConfig: Record<string, unknown> = {
      ...(canal.config ?? {}),
      phone_number_id:      metaRes.id,
      display_phone_number: metaRes.display_phone_number ?? `+${dto.cc}${dto.phone_number}`,
      verified_name:        dto.verified_name,
      waba_id:              this.wabaId,
      cc:                   dto.cc,
      raw_phone_number:     dto.phone_number,
    };

    await this.canalRepo.update({ id: canal.id }, { config: updatedConfig });

    // ── 4. Advance onboarding step ─────────────────────────────────────────
    if (stepIndex(client.onboarding_step) < stepIndex('wa_number_requested')) {
      await this.clientRepo.update(clientId, {
        onboarding_step: 'wa_number_requested',
      });
    }

    this.logger.log(
      `[OnboardingService] WhatsApp number registered ` +
        `[clientId=${clientId}, phone_number_id=${metaRes.id}, number=+${dto.cc}${dto.phone_number}]`,
    );

    return {
      phone_number_id: metaRes.id,
      message: `OTP sent via ${dto.code_method} to +${dto.cc}${dto.phone_number}. Call verify-whatsapp-otp to complete.`,
    };
  }

  // ── Step 2c: Verify WhatsApp OTP ──────────────────────────────────────────
  //
  // Validates the 6-digit code the admin received on their phone.
  // On success:
  //   - canal_entrada.is_active = true
  //   - onboarding_step → 'wa_number_verified'
  //
  // After this the number is live on Meta's Cloud API and can
  // receive/send messages.  The webhook controller routes by
  // phone_number_id so no further config is needed.

  async verifyWhatsAppOtp(
    clientId: string,
    canalEntradaId: string,
    dto: VerifyWhatsAppOtpDto,
  ): Promise<{ verified: boolean; phone_number_id: string; display_phone_number: string }> {
    this.assertMetaCredentials();

    const client = await this.loadActiveClient(clientId);
    this.requireStep(client, 'wa_number_requested');

    const canal = await this.canalRepo.findOneBy({ id: canalEntradaId });
    if (!canal) throw new NotFoundException(`Channel ${canalEntradaId} not found`);
    if (canal.client_id !== clientId) {
      throw new BadRequestException('Channel does not belong to this client.');
    }

    const phoneNumberId = canal.config?.phone_number_id as string | undefined;
    if (!phoneNumberId) {
      throw new BadRequestException(
        'phone_number_id not found in channel config. ' +
          'Run provision-whatsapp first.',
      );
    }

    // ── Verify OTP with Meta ───────────────────────────────────────────────
    await this.metaVerifyOtp(phoneNumberId, dto.code);

    // ── Mark canal active ─────────────────────────────────────────────────
    await this.canalRepo.update({ id: canal.id }, { is_active: true });

    // ── Advance onboarding step ───────────────────────────────────────────
    if (stepIndex(client.onboarding_step) < stepIndex('wa_number_verified')) {
      await this.clientRepo.update(clientId, {
        onboarding_step: 'wa_number_verified',
      });
    }

    const displayNumber = canal.config?.display_phone_number as string ?? phoneNumberId;

    this.logger.log(
      `[OnboardingService] WhatsApp OTP verified — number is live ` +
        `[clientId=${clientId}, phone_number_id=${phoneNumberId}]`,
    );

    return {
      verified:             true,
      phone_number_id:      phoneNumberId,
      display_phone_number: displayNumber,
    };
  }

  // ── Step 3: Verify non-WA channels (HMAC self-test) ──────────────────────

  async verifyChannel(
    clientId: string,
    canalEntradaId: string,
    dto: VerifyChannelDto,
  ): Promise<{ verified: boolean; channel: Partial<CanalEntrada> }> {
    const client = await this.loadActiveClient(clientId);

    // WA channels use provisionWhatsApp + verifyWhatsAppOtp instead
    const canal = await this.canalRepo.findOneBy({ id: canalEntradaId });
    if (!canal) throw new NotFoundException(`Channel ${canalEntradaId} not found`);
    if (canal.tipo === 'whatsapp') {
      throw new BadRequestException(
        'WhatsApp channels are verified via /provision-whatsapp and /verify-whatsapp-otp, not this endpoint.',
      );
    }

    // Require at minimum channel_configured (wa steps are optional for non-WA channels)
    this.requireStep(client, 'channel_configured');

    if (canal.client_id !== clientId) {
      throw new BadRequestException('Channel does not belong to this client.');
    }

    // ── HMAC verification ─────────────────────────────────────────────────
    const secret = canal.config?.webhook_secret as string | undefined;
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
      const sigBuffer    = Buffer.from(expectedSignature);
      const callerBuffer = Buffer.from(dto.test_signature);

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
      if (
        !expectedSignature.startsWith('sha256=') ||
        expectedSignature.length !== 71
      ) {
        throw new InternalServerErrorException(
          'HMAC self-test produced invalid output',
        );
      }
    }

    await this.canalRepo.update({ id: canal.id }, { is_active: true });

    if (stepIndex(client.onboarding_step) < stepIndex('channel_verified')) {
      await this.clientRepo.update(clientId, {
        onboarding_step: 'channel_verified',
      });
    }

    this.logger.log(
      `Channel verified [clientId=${clientId}, channelId=${canal.id}, is_active=true]`,
    );

    return {
      verified: true,
      channel: {
        id:        canal.id,
        nombre:    canal.nombre,
        tipo:      canal.tipo,
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

    const existing = await this.userRepo.findOneBy({
      email:     dto.email,
      client_id: clientId,
    });
    if (existing) {
      throw new ConflictException(
        `A user with email '${dto.email}' already exists for this client.`,
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = this.userRepo.create({
      email:     dto.email,
      password:  hashedPassword,
      full_name: dto.full_name ?? null,
      role:      'admin_cliente',
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

    const { password: _pwd, ...safeUser } = saved as User & { password: string };
    return safeUser;
  }

  // ── Step 5: Complete Onboarding ───────────────────────────────────────────

  async completeOnboarding(clientId: string): Promise<Client> {
    const client = await this.clientRepo.findOne({
      where:     { id: clientId },
      relations: ['canales', 'users'],
    });

    if (!client) throw new NotFoundException(`Client ${clientId} not found`);
    if (client.status !== 'onboarding') {
      throw new BadRequestException(
        `Client is not in onboarding status (current: ${client.status})`,
      );
    }

    const activeChannels = (client.canales ?? []).filter((c) => c.is_active);
    const adminUsers     = (client.users ?? []).filter((u) => u.role === 'admin_cliente');
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

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Client, { id: clientId }, {
        status:                   'active',
        onboarding_step:          'completed',
        onboarding_completed_at:  new Date(),
      });
    });

    this.logger.log(
      `Onboarding completed [clientId=${clientId}, duration=${Date.now() - startTime}ms]`,
    );

    return this.clientRepo.findOne({
      where:     { id: clientId },
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
