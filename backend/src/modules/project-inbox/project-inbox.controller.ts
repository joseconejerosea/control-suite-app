import {
  Controller, Get, Put, Post, Param, Body, UseGuards, Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProjectInboxService } from './project-inbox.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { FastifyRequest } from 'fastify';

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard, RolesGuard)
@Controller('v1/app/project-inbox')
export class ProjectInboxController {
  constructor(private readonly svc: ProjectInboxService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findAll(@CurrentUser() user: JwtPayload) {
    return this.svc.findAll(user.client_id);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.findOne(user.client_id, id);
  }

  @Post('upload')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'UPLOAD_BRIEF', entity: 'project_inbox' })
  upload(
    @CurrentUser() user: JwtPayload,
    @Body() body: { source?: string; raw_content: Record<string, unknown> },
  ) {
    return this.svc.createFromUpload(
      user.client_id,
      body.source ?? 'UPLOAD',
      body.raw_content,
    );
  }

  @Put(':id/approve')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'APPROVE_INBOX', entity: 'project_inbox' })
  approve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.approve(user.client_id, id, user.sub, body, req.ip);
  }

  @Put(':id/reject')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'REJECT_INBOX', entity: 'project_inbox' })
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.reject(user.client_id, id, user.sub, reason ?? '', req.ip);
  }
}
