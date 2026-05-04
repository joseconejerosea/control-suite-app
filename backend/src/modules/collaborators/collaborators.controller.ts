import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CollaboratorsService } from './collaborators.service';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';

interface AuthedRequest extends Request {
  user: { id: string; client_id: string; role: string };
}

@Controller('collaborators')
@UseGuards(AuthGuard, RolesGuard, ClientActiveGuard)
export class CollaboratorsController {
  constructor(private readonly service: CollaboratorsService) {}

  @Post()
  @Roles('admin_cliente', 'super_admin')
  create(@Req() req: AuthedRequest, @Body() dto: CreateCollaboratorDto) {
    return this.service.create(req.user.client_id, dto);
  }

  @Get()
  @Roles('admin_cliente', 'super_admin', 'user')
  findAll(@Req() req: AuthedRequest, @Query('project_id') projectId?: string) {
    return this.service.findAll(req.user.client_id, projectId);
  }

  @Get(':id')
  @Roles('admin_cliente', 'super_admin', 'user')
  findOne(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user.client_id, id);
  }

  @Patch(':id')
  @Roles('admin_cliente', 'super_admin')
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollaboratorDto,
  ) {
    return this.service.update(req.user.client_id, id, dto);
  }
}