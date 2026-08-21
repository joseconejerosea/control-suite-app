import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe,
  Patch, Post, Put, Query, Req, UseGuards,
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
import { IsString, IsNotEmpty, IsArray, IsBoolean, IsOptional, IsUUID, ValidateNested, IsIn, IsEmail } from 'class-validator';
import { Type } from 'class-transformer';

interface AuthedRequest extends Request {
  // El AuthGuard puebla req.user con el JWT decodificado, cuyo id de usuario es el
  // claim `sub` (no `id`). Tipar `id` acá compilaba pero devolvía undefined en runtime.
  user: { sub: string; client_id: string; role: string };
}

// ── DTOs inline (small, project-specific) ────────────────────────────────────

export class ConvocatoriaItemDto {
  @IsUUID() persona_id: string;
  // B3: la validación de FORMATO/ausencia de fecha NO vive en el pipe global
  // (emitía un error crudo con prefijo "items.N." y lo repetía por cada anfitrión).
  // Se valida a mano en el servicio (assertConvocatoriaDatesValid) para dar UN solo
  // mensaje limpio. Acá `dia` queda REQUERIDO (string) para no romper el tipo del
  // servicio (ConvocatoriaItem.dia: string); el front siempre manda el campo (aunque
  // vacío), y el guard atrapa vacío/no-ISO con el mensaje amigable.
  @IsString() dia: string;
  @IsOptional() @IsString() local_nombre?: string;
  @IsOptional() @IsString() local_direccion?: string;
}

export class EnviarConvocatoriaDto {
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
  // 'no_show'   — el operador marca (día de activación) que un promotor confirmado no se presentó.
  // 'cancelada' — el promotor confirmó pero luego avisa que no puede; dispara aviso de reemplazo.
  @IsString() @IsNotEmpty() @IsIn(['confirmada', 'rechazada', 'no_show', 'cancelada']) estado: string;
}

class AprobarProyectoDto {
  @IsOptional() @IsString() comentario?: string;
}

export class ConvocarAnfitrionesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConvocatoriaItemDto)
  items: ConvocatoriaItemDto[];

  @IsOptional() @IsString() comentario?: string;

  // T6 — force=true salta el chequeo de anti-choque de anfitrión (el operador ya
  // confirmó el pop-up "Convocar a ambas").
  @IsOptional() @IsBoolean() force?: boolean;
}

class ReportRecipientsDto {
  @IsArray()
  @IsEmail({}, { each: true })
  emails: string[];
}

// ── Controller ────────────────────────────────────────────────────────────────

@Controller('projects')
@UseGuards(AuthGuard, RolesGuard, ClientActiveGuard)
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Post()
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'CREATE_PROJECT', entity: 'Project' })
  create(@Req() req: AuthedRequest, @Body() dto: CreateProjectDto) {
    return this.service.create(req.user.client_id, dto);
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findAll(@Req() req: AuthedRequest) {
    return this.service.findAll(req.user.client_id);
  }

  // ── T9: Calendario global (read-only) ──────────────────────────────────────
  //   GET /projects/calendario?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  //   Agrega convocatorias de TODOS los proyectos del tenant + puntos sin cubrir.
  //   Declarado ANTES de :id para no chocar con el ParseUUIDPipe de findOne.
  @Get('calendario')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  getCalendarioGlobal(
    @Req() req: AuthedRequest,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
  ) {
    const isISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
    if (!isISO(desde) || !isISO(hasta)) {
      throw new BadRequestException('desde y hasta son requeridos (YYYY-MM-DD)');
    }
    return this.service.getCalendarioGlobal(req.user.client_id, desde, hasta);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  findOne(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(req.user.client_id, id);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'UPDATE_PROJECT', entity: 'Project' })
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.service.update(req.user.client_id, id, dto);
  }

  @Get(':id/summary')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  summary(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.summary(req.user.client_id, id);
  }

  // ── F5: Destinatarios del reporte al cliente (por proyecto) ───────────────
  //   GET /projects/:id/report-recipients → lista configurada
  //   PUT /projects/:id/report-recipients → reemplaza la lista

  @Get(':id/report-recipients')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  getReportRecipients(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getReportRecipients(req.user.client_id, id);
  }

  @Put(':id/report-recipients')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'SET_REPORT_RECIPIENTS', entity: 'Project' })
  setReportRecipients(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportRecipientsDto,
  ) {
    return this.service.setReportRecipients(req.user.client_id, id, dto.emails);
  }

  // ── F4: Aprobar proyecto (luego de revisión IA) ───────────────────────────

  @Post(':id/aprobar')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'APPROVE_PROJECT', entity: 'Project' })
  aprobar(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AprobarProyectoDto,
  ) {
    return this.service.aprobarProyecto(req.user.client_id, id, req.user.sub, dto.comentario);
  }

  // ── F4: Shift calendar — persona × día ───────────────────────────────────
  //   GET  /projects/:id/turno-equipo        → matriz persona × día
  //   POST /projects/:id/turno-equipo        → asignar persona a día(s)

  @Get(':id/turno-equipo')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  getTurnoEquipo(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTurnoEquipo(req.user.client_id, id);
  }

  @Post(':id/turno-equipo')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
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
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'SEND_CONVOCATION', entity: 'Project' })
  enviarConvocatoria(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnviarConvocatoriaDto,
  ) {
    return this.service.enviarConvocatoria(req.user.client_id, id, dto.items, dto.modo ?? 'manual');
  }

  @Get(':id/convocatorias')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN, UserRole.OPERATOR)
  getConvocatorias(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getConvocatorias(req.user.client_id, id);
  }

  @Patch(':id/convocatorias/:convId')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  updateConvocatoria(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('convId', ParseUUIDPipe) convId: string,
    @Body() dto: ResponderConvocatoriaDto,
  ) {
    return this.service.updateConvocatoria(req.user.client_id, id, convId, dto.estado);
  }

  // ── F4: Convocatoria de anfitriones — sugerencia IA + confirmar/enviar ────
  //   GET  /projects/:id/sugerir-convocatoria → promotores sugeridos por perfil IA
  //   POST /projects/:id/convocar-anfitriones  → aprueba + crea turnos + envía WA

  @Get(':id/sugerir-convocatoria')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  sugerirConvocatoria(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.sugerirConvocatoria(req.user.client_id, id);
  }

  @Post(':id/convocar-anfitriones')
  @Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @AuditAction({ action: 'SEND_CONVOCATION', entity: 'Project' })
  convocarAnfitriones(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvocarAnfitrionesDto,
  ) {
    return this.service.convocarAnfitriones(req.user.client_id, id, req.user.sub, dto.items, dto.comentario, dto.force ?? false);
  }
}
