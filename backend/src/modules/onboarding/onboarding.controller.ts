import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OnboardingService } from './onboarding.service';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { VerifyChannelDto } from './dto/verify-channel.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ProvisionWhatsAppDto } from './dto/provision-whatsapp.dto';
import { VerifyWhatsAppOtpDto } from './dto/verify-whatsapp-otp.dto';

/**
 * OnboardingController — structured F0 flow.
 *
 * Steps must be executed in order:
 *
 *   1. Client created (via ClientsController)
 *   2. POST /onboarding/:clientId/configure-channel
 *
 *   ── WhatsApp channel only (tipo='whatsapp') ──────────────────────────
 *   2b. POST /onboarding/:clientId/provision-whatsapp/:canalEntradaId
 *         → Registers number with Meta WABA, triggers OTP via SMS/VOICE
 *   2c. POST /onboarding/:clientId/verify-whatsapp-otp/:canalEntradaId
 *         → Admin enters 6-digit OTP; number goes live; canal marked active
 *   ─────────────────────────────────────────────────────────────────────
 *
 *   ── Non-WA channels (email, REST API, etc.) ──────────────────────────
 *   3.  POST /onboarding/:clientId/verify-channel/:canalEntradaId
 *         → HMAC self-test; marks channel active
 *   ─────────────────────────────────────────────────────────────────────
 *
 *   4. POST /onboarding/:clientId/create-admin
 *   5. POST /onboarding/:clientId/complete
 */
@Controller('onboarding')
@UseGuards(AuthGuard)
@Roles('super_admin')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /** Step 2 — Create a canal_entrada record for the client. */
  @Post(':clientId/configure-channel')
  configureChannel(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: ConfigureChannelDto,
  ) {
    return this.onboardingService.configureChannel(clientId, dto);
  }

  /**
   * Step 2b — WhatsApp only.
   * Calls Meta Business Management API to register the phone number on the
   * Control Suite WABA.  Meta will send an OTP to the number via SMS or VOICE.
   *
   * Required env vars: META_WABA_ID, META_SYSTEM_USER_TOKEN
   *
   * Body: { cc, phone_number, verified_name, code_method? }
   * Returns: { phone_number_id, message }
   */
  @Post(':clientId/provision-whatsapp/:canalEntradaId')
  provisionWhatsApp(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('canalEntradaId', ParseUUIDPipe) canalEntradaId: string,
    @Body() dto: ProvisionWhatsAppDto,
  ) {
    return this.onboardingService.provisionWhatsApp(clientId, canalEntradaId, dto);
  }

  /**
   * Step 2c — WhatsApp only.
   * Validates the 6-digit OTP the admin received on their phone.
   * On success: canal_entrada.is_active = true; number is live on Meta Cloud API.
   * The webhook controller will route messages by phone_number_id automatically.
   *
   * Body: { code }
   * Returns: { verified, phone_number_id, display_phone_number }
   */
  @Post(':clientId/verify-whatsapp-otp/:canalEntradaId')
  verifyWhatsAppOtp(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('canalEntradaId', ParseUUIDPipe) canalEntradaId: string,
    @Body() dto: VerifyWhatsAppOtpDto,
  ) {
    return this.onboardingService.verifyWhatsAppOtp(clientId, canalEntradaId, dto);
  }

  /** Step 3 — Non-WA channels. HMAC self-test; marks channel active. */
  @Post(':clientId/verify-channel/:canalEntradaId')
  verifyChannel(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('canalEntradaId', ParseUUIDPipe) canalEntradaId: string,
    @Body() dto: VerifyChannelDto,
  ) {
    return this.onboardingService.verifyChannel(clientId, canalEntradaId, dto);
  }

  /** Step 4 — Create an admin_cliente user for the tenant. */
  @Post(':clientId/create-admin')
  createAdmin(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateAdminUserDto,
  ) {
    return this.onboardingService.createAdminUser(clientId, dto);
  }

  /**
   * Step 5 — Validate all prerequisites and flip client to status='active'.
   * Returns the full client with relations on success.
   */
  @Post(':clientId/complete')
  completeOnboarding(
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.onboardingService.completeOnboarding(clientId);
  }
}
