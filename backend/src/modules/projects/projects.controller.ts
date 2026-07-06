import {
  Body, Controller, Get, Param, ParseUUIDPipe,
  Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { IsString, IsNotEmpty, IsArray, IsDateString, IsOptional, IsUUID, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

interface AuthedRequest extends Request {
  user: { id: string; client_id: string; role: string };
}

// ── DTOs inline (small, project-specific) ────────────────────────────────────

class ConvocatoriaItemDto {
  @IsUUID() persona_id: string;
  @IsDateString() dia: string;
  @IsOptional() @IsString() local_nombre?: string;
  @IsOptional() @IsString() local_direccion?: string;
}

class EnviarConvocatoriaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConvocatoriaItemDto)
  items: ConvocatoriaItemDto[];

  /** 'ai' = Mind redacta el mensaje | 'manual' = mensaje fijo estándar */
  @IsOptional()
  @IsIn(['ai', 'manual'])
  modo?: 'ai' | 'manual' = 'manual';
}

class ResponderConvocatoriaDto {
  // 'no_show' — el operador marca (día de activación) que un promotor confirmado no se presentó.
  @IsString() @IsNotEmpty() @IsIn(['confirmada', 'rechazada', 'no_show']) estado: string;
}

class AprobarProyectoDto {
  @IsOptional() @IsString() comentario?: string;
}

// ── Controller ────────────────────────────────────────────────────────────────

@Controller('projects')
@UseGuards(AuthGuard, RolesGuard, ClientActiveGuard)
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Post()
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  @AuditAction({ action: 'CREATE_PROJECT', entity: 'Project' })
  create(@Req() req: AuthedRequest, @Body() dto: CreateProjectDto) {
    return this.service.create(req.user.client_id, dto);
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findAll(@Req() req: AuthedRequest) {
    return this.service.findAll(req.user.client_id);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findOne(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user.client_id, id);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  @AuditAction({ action: 'UPDATE_PROJECT', entity: 'Project' })
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.service.update(req.user.client_id, id, dto);
  }

  @Get(':id/summary')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  summary(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.summary(req.user.client_id, id);
  }

  // ── F4: Aprobar proyecto (luego de revisión IA) ───────────────────────────

  @Post(':id/aprobar')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  @AuditAction({ action: 'APPROVE_PROJECT', entity: 'Project' })
  aprobar(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AprobarProyectoDto,
  ) {
    return this.service.aprobarProyecto(req.user.client_id, id, req.user.id, dto.comentario);
  }

  // ── F4: Shift calendar — persona × día ───────────────────────────────────
  //   GET  /projects/:id/turno-equipo        → matriz persona × día
  //   POST /projects/:id/turno-equipo        → asignar persona a día(s)

  @Get(':id/turno-equipo')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  getTurnoEquipo(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTurnoEquipo(req.user.client_id, id);
  }

  @Post(':id/turno-equipo')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  asignarTurno(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { persona_id: string; dias: string[]; local_nombre?: string; local_direccion?: string },
  ) {
    return this.service.asignarTurno(req.user.client_id, id, body);
  }

  // ── F4: Convocatoria por WhatsApp ─────────────────────────────────────────
  //   POST /projects/:id/convocar        → enviar WA a promotores seleccionados
  //   GET  /projects/:id/convocatorias   → lista de convocatorias del proyecto
  //   PATCH /projects/:id/convocatorias/:convId → actualizar estado manualmente

  @Post(':id/convocar')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  @AuditAction({ action: 'SEND_CONVOCATION', entity: 'Project' })
  enviarConvocatoria(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnviarConvocatoriaDto,
  ) {
    return this.service.enviarConvocatoria(req.user.client_id, id, dto.items, dto.modo ?? 'manual');
  }

  @Get(':id/convocatorias')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN, UserRole.OPERATOR)
  getConvocatorias(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getConvocatorias(req.user.client_id, id);
  }

  @Patch(':id/convocatorias/:convId')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  updateConvocatoria(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('convId', ParseUUIDPipe) convId: string,
    @Body() dto: ResponderConvocatoriaDto,
  ) {
    return this.service.updateConvocatoria(req.user.client_id, id, convId, dto.estado);
  }
}
