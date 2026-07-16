import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
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
import { tenantManager } from '../../common/tenant/tenant-context';
import { UserRole } from '../../common/enums/user-role.enum';

const META_API = 'https://graph.facebook.com/v19.0';
const META_TIMEOUT_MS = 15_000;

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

  // Fase 2 — canal_entrada tiene RLS: usar el repo ligado al contexto de tenant.
  private get canalRepoCtx(): Repository<CanalEntrada> {
    return tenantManager(this.dataSource).getRepository(CanalEntrada);
  }

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

    const canal = this.canalRepoCtx.create({
      nombre: dto.nombre, tipo: dto.tipo,
      config: dto.config ?? null, client_id: clientId, is_active: false,
    });
    const savedCanal = await this.canalRepoCtx.save(canal);

    if (stepIndex(client.onboarding_step) < stepIndex('channel_configured')) {
      await this.clientRepo.update(clientId, { onboarding_step: 'channel_configured' });
    }
    this.logger.log(`Channel configured [clientId=${clientId}, channelId=${savedCanal.id}, tipo=${dto.tipo}]`);
    return savedCanal;
  }

  // ── Step 2b: Provision WhatsApp ───────────────────────────────────────────
  // Registers a new number against the Meta WhatsApp Cloud API (WABA) and
  // triggers the OTP. The number stays inactive until the OTP is verified.

  async provisionWhatsApp(
    clientId: string,
    canalEntradaId: string,
    dto: ProvisionWhatsAppDto,
  ): Promise<{ phone_number_id: string; message: string }> {
    // R3-008/R4-006 — fail-fast on server misconfiguration before touching Meta,
    // otherwise we would POST to a malformed URL (empty WABA id) or send
    // `Bearer undefined`.
    this.assertMetaConfig();

    const client = await this.loadActiveClient(clientId);
    this.requireStep(client, 'channel_configured');

    const canal = await this.canalRepoCtx.findOneBy({ id: canalEntradaId });
    if (!canal) throw new NotFoundException(`Channel ${canalEntradaId} not found`);
    if (canal.client_id !== clientId) throw new BadRequestException('Channel does not belong to this client.');
    if (canal.tipo !== 'whatsapp') throw new BadRequestException(`Channel tipo must be 'whatsapp'.`);

    // R3-014 — idempotency: if this channel already carries a phone_number_id we
    // must NOT create a second number at Meta (that would orphan a registration
    // and burn the number). Re-request the OTP on the existing id instead so the
    // flow is safely resumable (e.g. the user lost the first code).
    const existingPhoneNumberId = canal.config?.phone_number_id as string | undefined;
    if (existingPhoneNumberId) {
      await this.metaPost(`${existingPhoneNumberId}/request_code`, {
        code_method: dto.code_method,
        language:    'es',
      });
      const existingDisplay =
        (canal.config?.display_phone_number as string | undefined) ??
        `+${dto.cc}${dto.phone_number}`;
      this.logger.log(
        `[OnboardingService] WA OTP re-requested on existing number [clientId=${clientId}, phone_number_id=${existingPhoneNumberId}]`,
      );
      return {
        phone_number_id: existingPhoneNumberId,
        message:         `OTP re-sent via ${dto.code_method} to ${existingDisplay}. Verify it to finish registration.`,
      };
    }

    // 1) Register the phone number under the WABA. Meta returns the real id.
    const created = await this.metaPost(`${this.wabaId}/phone_numbers`, {
      cc:            dto.cc,
      phone_number:  dto.phone_number,
      verified_name: dto.verified_name,
    });
    const phoneNumberId = created?.id as string | undefined;
    if (!phoneNumberId) {
      this.logger.error(`[OnboardingService] Meta phone_numbers returned no id: ${JSON.stringify(created)}`);
      throw new BadRequestException('Meta did not return a phone_number_id.');
    }

    // 2) Request the OTP for the freshly created number.
    await this.metaPost(`${phoneNumberId}/request_code`, {
      code_method: dto.code_method,
      language:    'es',
    });

    const displayPhoneNumber = `+${dto.cc}${dto.phone_number}`;
    await this.canalRepoCtx.update({ id: canal.id }, {
      config: {
        ...(canal.config ?? {}),
        phone_number_id:      phoneNumberId,
        display_phone_number: displayPhoneNumber,
        verified_name:        dto.verified_name,
        waba_id:              this.wabaId,
        cc:                   dto.cc,
        raw_phone_number:     dto.phone_number,
      },
      is_active: false, // Not active until the OTP is verified.
    });

    if (stepIndex(client.onboarding_step) < stepIndex('wa_number_requested')) {
      await this.clientRepo.update(clientId, { onboarding_step: 'wa_number_requested' });
    }

    this.logger.log(`[OnboardingService] WA number requested [clientId=${clientId}, phone_number_id=${phoneNumberId}]`);
    return {
      phone_number_id: phoneNumberId,
      message:         `OTP sent via ${dto.code_method} to ${displayPhoneNumber}. Verify it to finish registration.`,
    };
  }

  // ── Step 2c: Verify OTP ───────────────────────────────────────────────────
  // Confirms the OTP with Meta and completes the Cloud API two-step
  // registration, then activates the channel.

  async verifyWhatsAppOtp(
    clientId: string,
    canalEntradaId: string,
    dto: VerifyWhatsAppOtpDto,
  ): Promise<{ verified: boolean; phone_number_id: string; display_phone_number: string }> {
    // R3-008/R4-006 — fail-fast on server misconfiguration before touching Meta.
    this.assertMetaConfig();

    // R1-004/R4-007 — fail-closed PIN: resolve it BEFORE any Meta call so a
    // missing/empty WHATSAPP_REGISTER_PIN aborts the whole flow. We must never
    // fall back to a default PIN (that would register the number with a
    // guessable two-step PIN) and we must not even verify the OTP if we cannot
    // finish registration afterwards.
    const pin = process.env.WHATSAPP_REGISTER_PIN?.trim();
    if (!pin) {
      this.logger.error('[OnboardingService] WHATSAPP_REGISTER_PIN not configured — refusing to register.');
      throw new InternalServerErrorException('WHATSAPP_REGISTER_PIN not configured.');
    }

    const client = await this.loadActiveClient(clientId);
    this.requireStep(client, 'wa_number_requested');

    const canal = await this.canalRepoCtx.findOneBy({ id: canalEntradaId });
    if (!canal) throw new NotFoundException(`Channel ${canalEntradaId} not found`);
    if (canal.client_id !== clientId) throw new BadRequestException('Channel does not belong to this client.');

    const phoneNumberId = canal.config?.phone_number_id as string | undefined;
    if (!phoneNumberId) {
      throw new BadRequestException('Number not provisioned — call provision-whatsapp first.');
    }
    const displayNumber = (canal.config?.display_phone_number as string | undefined) ?? phoneNumberId;

    // 1) Verify the OTP code with Meta.
    await this.metaPost(`${phoneNumberId}/verify_code`, { code: dto.code });

    // 2) Complete the Cloud API two-step registration with the PIN, then activate
    // the channel. R3-007/R4-005 — from here on the OTP is already consumed at
    // Meta; if register OR the local activation fails we cannot roll Meta back, so
    // we emit an explicit greppable recovery signal (WA_PARTIAL_REGISTRATION) and
    // rethrow. The number may be registered at Meta but inactive locally and needs
    // manual reconciliation.
    try {
      await this.metaPost(`${phoneNumberId}/register`, {
        messaging_product: 'whatsapp',
        pin,
      });

      await this.canalRepoCtx.update({ id: canal.id }, { is_active: true });
    } catch (err: any) {
      this.logger.error(
        `[OnboardingService] WA_PARTIAL_REGISTRATION — OTP verified but registration/activation failed ` +
          `[clientId=${clientId}, phone_number_id=${phoneNumberId}]. The number may be registered at Meta ` +
          `but is NOT active locally; manual recovery required. Cause: ${err?.message ?? err}`,
      );
      throw err;
    }

    if (stepIndex(client.onboarding_step) < stepIndex('wa_number_verified')) {
      await this.clientRepo.update(clientId, { onboarding_step: 'wa_number_verified' });
    }

    this.logger.log(`[OnboardingService] WA number verified [clientId=${clientId}, phone_number_id=${phoneNumberId}]`);
    return { verified: true, phone_number_id: phoneNumberId, display_phone_number: displayNumber };
  }

  /**
   * R3-008/R4-006 — assert the server-side Meta configuration is present before
   * issuing any Graph API call, so we never send a malformed URL (empty WABA id)
   * nor an `Authorization: Bearer undefined` header. This is a server
   * misconfiguration, hence a 500-class error.
   */
  private assertMetaConfig(): void {
    if (!this.wabaId) {
      this.logger.error('[OnboardingService] WABA id not configured (META_WABA_ID / WHATSAPP_BUSINESS_ACCOUNT_ID).');
      throw new InternalServerErrorException('WhatsApp WABA id not configured.');
    }
    if (!process.env.WHATSAPP_ACCESS_TOKEN?.trim()) {
      this.logger.error('[OnboardingService] WHATSAPP_ACCESS_TOKEN not configured.');
      throw new InternalServerErrorException('WHATSAPP_ACCESS_TOKEN not configured.');
    }
  }

  /**
   * POST to the Meta Graph API with the permanent System User token.
   * Returns the parsed JSON body on success; throws BadRequestException with
   * Meta's error message on any non-ok response.
   *
   * R4-004 — native fetch has no timeout; a hung Meta connection would stall the
   * request indefinitely. Bound each call with an AbortController and surface an
   * abort as an explicit GatewayTimeout.
   */
  private async metaPost(path: string, body: Record<string, unknown>): Promise<any> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${META_API}/${path}`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        this.logger.error(`[OnboardingService] Meta request timed out after ${META_TIMEOUT_MS}ms [${path}]`);
        throw new GatewayTimeoutException(`Meta request timed out after ${META_TIMEOUT_MS}ms.`);
      }
      this.logger.error(`[OnboardingService] Meta request failed [${path}]: ${err?.message}`);
      throw new BadRequestException(`Meta request failed: ${err?.message ?? 'network error'}`);
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const metaMessage = data?.error?.message ?? JSON.stringify(data);
      this.logger.error(`[OnboardingService] Meta error [${path}]: ${JSON.stringify(data)}`);
      throw new BadRequestException(`Meta API error: ${metaMessage}`);
    }
    return data;
  }

  // ── Step 3: Verify non-WA channels ───────────────────────────────────────

  async verifyChannel(
    clientId: string,
    canalEntradaId: string,
    dto: VerifyChannelDto,
  ): Promise<{ verified: boolean; channel: Partial<CanalEntrada> }> {
    const client = await this.loadActiveClient(clientId);
    const canal  = await this.canalRepoCtx.findOneBy({ id: canalEntradaId });
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

    await this.canalRepoCtx.update({ id: canal.id }, { is_active: true });
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
      role:      UserRole.MANAGER,
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
    if (!(client.users ?? []).some(u => u.role === UserRole.MANAGER)) errors.push('At least one admin_cliente user required.');
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