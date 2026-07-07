import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { DashboardService } from './dashboard.service';
import { DashboardFiltersDto } from './dto/dashboard-filters.dto';

interface AuthedRequest extends Request {
  user: { id: string; client_id: string; role: string };
}

@Controller('dashboard')
@UseGuards(AuthGuard, RolesGuard, ClientActiveGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('overview')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  overview(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.overview(req.user.client_id, filters);
  }

  @Get('campaigns')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  campaigns(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.campaigns(req.user.client_id, filters);
  }

  @Get('activations')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  activations(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.activations(req.user.client_id, filters);
  }

  @Get('events')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  events(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.events(req.user.client_id, filters);
  }

  @Get('documents')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  documents(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.documents(req.user.client_id, filters);
  }
}