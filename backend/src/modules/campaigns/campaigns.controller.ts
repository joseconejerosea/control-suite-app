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
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@Controller('campaigns')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('project_id') projectId?: string,
  ) {
    return this.campaignsService.findAll(user.client_id, projectId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaignsService.findOne(user.client_id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuditAction({ action: 'CREATE_CAMPAIGN', entity: 'Campaign' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaignsService.create(user.client_id, dto);
  }

  @Patch(':id')
  @AuditAction({ action: 'UPDATE_CAMPAIGN', entity: 'Campaign' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.update(user.client_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditAction({ action: 'DELETE_CAMPAIGN', entity: 'Campaign' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaignsService.remove(user.client_id, id);
  }
}