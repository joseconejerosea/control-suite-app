import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

interface AuthedRequest extends Request {
  user: { id: string; client_id: string; role: string };
}

@Controller('projects')
@UseGuards(AuthGuard, RolesGuard, ClientActiveGuard)
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Post()
  @Roles('admin_cliente', 'super_admin')
  create(@Req() req: AuthedRequest, @Body() dto: CreateProjectDto) {
    return this.service.create(req.user.client_id, dto);
  }

  @Get()
  @Roles('admin_cliente', 'super_admin', 'user')
  findAll(@Req() req: AuthedRequest) {
    return this.service.findAll(req.user.client_id);
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
    @Body() dto: UpdateProjectDto,
  ) {
    return this.service.update(req.user.client_id, id, dto);
  }

  @Get(':id/summary')
  @Roles('admin_cliente', 'super_admin', 'user')
  summary(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.summary(req.user.client_id, id);
  }
}
