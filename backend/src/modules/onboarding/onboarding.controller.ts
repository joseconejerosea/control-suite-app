import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { OnboardingService } from './onboarding.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';

/**
 * OnboardingController — single global WhatsApp number model.
 *
 * A tenant no longer configures channels during onboarding (WhatsApp is universal,
 * email is connected later via Gmail in config). The flow is:
 *
 *   1. Client created (via ClientsController) → gets an affiliation code.
 *   2. POST /onboarding/:clientId/create-admin
 *   3. POST /onboarding/:clientId/complete
 */
@Controller('onboarding')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /** Step 2 — Create an admin_cliente user (Manager) for the tenant. */
  @Post(':clientId/create-admin')
  createAdmin(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateAdminUserDto,
  ) {
    return this.onboardingService.createAdminUser(clientId, dto);
  }

  /**
   * Step 3 — Validate prerequisites and flip client to status='active'.
   * Returns the full client with relations on success.
   */
  @Post(':clientId/complete')
  completeOnboarding(@Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.onboardingService.completeOnboarding(clientId);
  }
}
