import { Controller, Get, Post, Patch, Body, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { SupportService } from './support.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

// Client-facing ticket routes
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
  create(@CurrentUser() user: JwtPayload, @Body() body: { tipo: string; descripcion: string; prioridad?: string }) {
    return this.svc.create({ ...body, client_id: user.client_id, user_id: user.sub });
  }
}

// Admin ticket routes
@Controller('admin/support/tickets')
@UseGuards(AuthGuard)
export class AdminSupportController {
  constructor(private readonly svc: SupportService) {}

  @Get()
  findAll(@Query('estado') estado?: string, @Query('prioridad') prioridad?: string, @Query('client_id') client_id?: string) {
    return this.svc.findAll({ estado, prioridad, client_id });
  }

  @Get('kpis')
  kpis() { return this.svc.kpis(); }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findOne(id);
  }

  @Patch(':id/estado')
  updateEstado(@Param('id', ParseUUIDPipe) id: string, @Body() body: { estado: string }) {
    return this.svc.updateEstado(id, body.estado);
  }

  @Post(':id/responder')
  responder(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: { respuesta: string }) {
    return this.svc.responder(id, body.respuesta, user.sub);
  }
}
