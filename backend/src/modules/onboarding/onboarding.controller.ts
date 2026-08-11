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
import { UserRole } from '../../common/enums/user-role.enum';
import { OnboardingService } from './onboarding.service';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { VerifyChannelDto } from './dto/verify-channel.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';

/**
 * OnboardingController — structured F0 flow.
 *
 * Steps must be executed in order:
 *
 *   1. Client created (via ClientsController)
 *   2. POST /onboarding/:clientId/configure-channel
 *         → WhatsApp channels (tipo='whatsapp') use the single global number, so
 *           they are marked active on configuration (no Meta registration/OTP).
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
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
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
