import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  Body,
  Req,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { F1ReviewService } from './f1-review.service';

interface AuthedRequest extends Request {
  // The JWT payload uses `sub` for the user id (see JwtPayload / auth.guard).
  // There is no `user.id` — reading it yields undefined.
  user: { sub: string; client_id: string; role: string };
}

@Controller('app/f1-documents')
@UseGuards(AuthGuard, RolesGuard)
export class F1ReviewController {
  constructor(private readonly service: F1ReviewService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findAll(
    @Req() req: AuthedRequest,
    @Query('project_id') projectId?: string,
    @Query('tipo') tipo?: string,
    @Query('status') status?: string,
    @Query('confidence_min') confidenceMin?: string,
    @Query('confidence_max') confidenceMax?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(req.user.client_id, {
      project_id: projectId,
      tipo,
      status,
      confidence_min: confidenceMin ? parseFloat(confidenceMin) : undefined,
      confidence_max: confidenceMax ? parseFloat(confidenceMax) : undefined,
      date_from: dateFrom,
      date_to: dateTo,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findOne(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(req.user.client_id, id);
  }

  @Put(':id/approve')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'APPROVE_DOCUMENT', entity: 'eventos_crudos' })
  approve(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approve(
      req.user.client_id,
      id,
      req.user.sub,
      req.ip ?? '',
    );
  }

  @Put(':id/reject')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'REJECT_DOCUMENT', entity: 'eventos_crudos' })
  reject(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.service.reject(
      req.user.client_id,
      id,
      req.user.sub,
      reason ?? '',
      req.ip ?? '',
    );
  }
}
