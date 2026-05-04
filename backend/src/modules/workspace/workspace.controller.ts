import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { WorkspaceService } from './workspace.service';

interface AuthedRequest extends Request {
  user: { id: string; client_id: string; role: string };
}

@Controller('workspace')
@UseGuards(AuthGuard, ClientActiveGuard)
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  @Get('context')
  context(@Req() req: AuthedRequest) {
    return this.service.context(req.user.client_id, req.user.id, req.user.role);
  }

  @Get('master-data-status')
  masterDataStatus(@Req() req: AuthedRequest) {
    return this.service.masterDataStatus(req.user.client_id);
  }
}