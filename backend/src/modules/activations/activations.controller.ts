import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ActivationsService } from './activations.service';
import { CreateActivationDto, UpdateActivationDto } from './dto/activation.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@Controller('activations')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class ActivationsController {
  constructor(private readonly activationsService: ActivationsService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('campaign_id') campaignId?: string,
    @Query('project_id') projectId?: string,
  ) {
    if (campaignId) {
      return this.activationsService.findByCampaign(user.client_id, campaignId);
    }
    if (projectId) {
      return this.activationsService.findByProject(user.client_id, projectId);
    }
    return this.activationsService.findAll(user.client_id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.activationsService.findOne(user.client_id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuditAction({ action: 'CREATE_ACTIVATION', entity: 'Activation' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateActivationDto,
  ) {
    return this.activationsService.create(user.client_id, dto);
  }

  @Patch(':id')
  @AuditAction({ action: 'UPDATE_ACTIVATION', entity: 'Activation' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActivationDto,
  ) {
    return this.activationsService.update(user.client_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditAction({ action: 'DELETE_ACTIVATION', entity: 'Activation' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.activationsService.remove(user.client_id, id);
  }

  // ── F5 sub-resources ─────────────────────────────────────────────

  @Get(':id/checkins')
  findCheckins(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.activationsService.findCheckins(user.client_id, id);
  }

  @Get(':id/incidencias')
  findIncidencias(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.activationsService.findIncidencias(user.client_id, id);
  }

  @Get(':id/reportes')
  findReportes(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.activationsService.findReportes(user.client_id, id);
  }
}
