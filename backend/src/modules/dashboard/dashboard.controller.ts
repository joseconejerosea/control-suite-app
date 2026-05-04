import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { Roles } from '../../common/decorators/roles.decorator';
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
  @Roles('admin_cliente', 'super_admin', 'user')
  overview(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.overview(req.user.client_id, filters);
  }

  @Get('campaigns')
  @Roles('admin_cliente', 'super_admin')
  campaigns(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.campaigns(req.user.client_id, filters);
  }

  @Get('activations')
  @Roles('admin_cliente', 'super_admin')
  activations(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.activations(req.user.client_id, filters);
  }

  @Get('events')
  @Roles('admin_cliente', 'super_admin')
  events(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.events(req.user.client_id, filters);
  }

  @Get('documents')
  @Roles('admin_cliente', 'super_admin')
  documents(@Req() req: AuthedRequest, @Query() filters: DashboardFiltersDto) {
    return this.service.documents(req.user.client_id, filters);
  }
}