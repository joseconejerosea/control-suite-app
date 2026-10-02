import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PendingStaffService } from './pending-staff.service';
import { ListPendingStaffQueryDto } from './dto/list-pending-staff-query.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

/**
 * Roster-gap management endpoints.
 *
 * Guard stack matches notifications/promoters: AuthGuard → ClientIsolationGuard →
 * ClientActiveGuard. The global TenantInterceptor opens the tenant tx so
 * ds.query() inside the service is already tenant-scoped.
 *
 * client_id comes from the JWT (user.client_id), never from the request body.
 */
@Controller('pending-staff')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class PendingStaffController {
  constructor(private readonly pendingStaffService: PendingStaffService) {}

  /**
   * GET /pending-staff?estado=pendiente
   * Returns all pending_staff rows for the tenant, optionally filtered by estado.
   */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListPendingStaffQueryDto,
  ) {
    return this.pendingStaffService.list(user.client_id, query.estado);
  }

  /**
   * PATCH /pending-staff/:id/agregar
   * Transitions the row to estado='agregado'.
   * Returns { phone } so the frontend can pre-fill the promoter create form.
   */
  @Patch(':id/agregar')
  @HttpCode(HttpStatus.OK)
  async markAgregado(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pendingStaffService.markAgregado(user.client_id, id);
  }

  /**
   * PATCH /pending-staff/:id/descartar
   * Transitions the row to estado='descartado'. Row persists as history.
   * Returns { success: true }.
   */
  @Patch(':id/descartar')
  @HttpCode(HttpStatus.OK)
  async markDescartado(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pendingStaffService.markDescartado(user.client_id, id);
  }
}
