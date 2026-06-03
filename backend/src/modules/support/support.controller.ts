import {
  Controller, Get, Post, Patch, Body,
  Param, ParseUUIDPipe, Query, UseGuards,
} from '@nestjs/common';
import { SupportService } from './support.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { IsString, IsNotEmpty, IsArray, IsOptional, IsIn } from 'class-validator';

class BroadcastDto {
  @IsString() @IsNotEmpty() mensaje: string;

  /** 'whatsapp' | 'email' | 'banner' — puede ser combinación */
  @IsArray()
  @IsIn(['whatsapp', 'email', 'banner'], { each: true })
  canales: ('whatsapp' | 'email' | 'banner')[];

  /** Si viene vacío → enviar a TODOS los clientes activos */
  @IsOptional() @IsArray() client_ids?: string[];

  @IsOptional() @IsString() asunto?: string;
}

// ── Client-facing ticket routes ───────────────────────────────────────────────
@Controller('support/tickets')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('estado') estado?: string) {
    return this.svc.findAll({ estado, client_id: user.client_id });
  }

  @Get('kpis')
  kpis() { return this.svc.kpis(); }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { tipo: string; descripcion: string; prioridad?: string },
  ) {
    return this.svc.create({ ...body, client_id: user.client_id, user_id: user.sub });
  }
}

// ── Admin ticket routes ───────────────────────────────────────────────────────
@Controller('admin/support/tickets')
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class AdminSupportController {
  constructor(private readonly svc: SupportService) {}

  @Get()
  findAll(
    @Query('estado') estado?: string,
    @Query('prioridad') prioridad?: string,
    @Query('client_id') client_id?: string,
  ) {
    return this.svc.findAll({ estado, prioridad, client_id });
  }

  @Get('kpis')
  kpis() { return this.svc.kpis(); }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findOne(id);
  }

  @Patch(':id/estado')
  updateEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { estado: string },
  ) {
    return this.svc.updateEstado(id, body.estado);
  }

  @Post(':id/responder')
  responder(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { respuesta: string },
  ) {
    return this.svc.responder(id, body.respuesta, user.sub);
  }

  // ── Brief §A5: Proactive comms — send WA/email/banner to N clients ──────
  // POST /admin/support/broadcast
  @Post('broadcast')
  broadcast(@Body() dto: BroadcastDto) {
    return this.svc.broadcast(dto);
  }
}
