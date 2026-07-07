import {
  Controller, Get, Post, Param, Body, Request, Res, Query, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { MindPropuestasService } from './mind-propuestas.service';
import { MindChatService } from './mind-chat.service';
import { MindAnalistaService } from './mind-analista.service';
import { SendMessageDto, AprobarPropuestaDto, RechazarPropuestaDto } from './dto/mind.dto';

@UseGuards(AuthGuard, RolesGuard, ClientIsolationGuard, ClientActiveGuard)
@Roles(UserRole.MANAGER, UserRole.SERVICE_LEAD, UserRole.OPERATOR, UserRole.SUPERADMIN)
@Controller('v1/app/mind')
export class MindController {
  constructor(
    private readonly propuestasService: MindPropuestasService,
    private readonly chatService: MindChatService,
    private readonly analistaService: MindAnalistaService,
  ) {}

  @Get('propuestas')
  propuestasActivas(@Request() req: any) {
    return this.propuestasService.findActivas(req.user.client_id);
  }

  @Get('propuestas/all')
  propuestasAll(@Request() req: any, @Query('limit') limit?: string) {
    return this.propuestasService.findAll(req.user.client_id, limit ? parseInt(limit) : 50);
  }

  @Get('propuestas/dashboard')
  dashboard(@Request() req: any) {
    return this.propuestasService.resumenDashboard(req.user.client_id);
  }

  @Post('propuestas/:id/aprobar')
  @AuditAction({ action: 'MIND_APPROVE_PROPOSAL', entity: 'MindPropuesta' })
  aprobar(@Request() req: any, @Param('id') id: string, @Body() _dto: AprobarPropuestaDto) {
    return this.propuestasService.aprobar(req.user.client_id, id, req.user.sub);
  }

  @Post('propuestas/:id/rechazar')
  @AuditAction({ action: 'MIND_REJECT_PROPOSAL', entity: 'MindPropuesta' })
  rechazar(@Request() req: any, @Param('id') id: string, @Body() dto: RechazarPropuestaDto) {
    return this.propuestasService.rechazar(req.user.client_id, id, dto.motivo);
  }

  @Get('chat/history')
  history(@Request() req: any, @Query('limit') limit?: string) {
    return this.chatService.getHistory(req.user.client_id, req.user.sub, limit ? parseInt(limit) : 50);
  }

  @Post('chat')
  async sendMessage(@Request() req: any, @Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(req.user.client_id, req.user.sub, dto.mensaje);
  }

  @Get('chat/stream')
  async streamChat(
    @Request() req: any,
    @Query('mensaje') mensaje: string,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    try {
      const { reply, tools_used } = await this.chatService.sendMessage(
        req.user.client_id, req.user.sub, mensaje,
      );
      res.write(`data: ${JSON.stringify({ type: 'text', content: reply })}\n\n`);
      if (tools_used.length) {
        res.write(`data: ${JSON.stringify({ type: 'tools', tools: tools_used })}\n\n`);
      }
    } catch {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error' })}\n\n`);
    } finally {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }

  @Get('analista/insights')
  async insights(@Request() req: any) {
    return this.analistaService.analizarComoEstamos(req.user.client_id);
  }

  @Get('analista/resumen-mensual')
  async resumenMensual(@Request() req: any) {
    return this.analistaService.generarInsightsMensuales(req.user.client_id);
  }

  @Get('analista/proyecto/:projectId')
  async cierreProyecto(@Request() req: any, @Param('projectId') projectId: string) {
    return this.analistaService.analizarCierreProyecto(req.user.client_id, projectId);
  }
}