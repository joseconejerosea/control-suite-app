import { Controller, Get, Post, Patch, Body, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { ResendEmailService } from '../../common/email/resend.service';

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
@Controller('v1/app/f5')
export class F5Controller {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly emailService: ResendEmailService,
    @InjectQueue('report-gen') private readonly reportQueue: Queue,
  ) {}

  @Get('activaciones/:id/checkins')
  async getCheckins(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ds.query(
      `SELECT * FROM checkins WHERE activacion_id=$1 AND client_id=$2 ORDER BY ts DESC`,
      [id, user.client_id],
    ).catch(() => []);
  }

  @Post('activaciones/:id/checkins')
  async createCheckin(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    const res = await this.ds.query(
      `INSERT INTO checkins (client_id, activacion_id, persona_id, observacion) VALUES ($1,$2,$3,$4) RETURNING *`,
      [user.client_id, id, body.persona_id ?? user.sub, body.observacion ?? null],
    );
    return res[0];
  }

  @Get('activaciones/:id/incidencias')
  async getIncidencias(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ds.query(
      `SELECT * FROM incidencias WHERE activacion_id=$1 AND client_id=$2 ORDER BY created_at DESC`,
      [id, user.client_id],
    ).catch(() => []);
  }

  @Post('activaciones/:id/incidencias')
  async createIncidencia(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    const res = await this.ds.query(
      `INSERT INTO incidencias (client_id, activacion_id, persona_id, descripcion, categoria, severidad)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [user.client_id, id, user.sub, body.descripcion, body.categoria ?? 'general', body.severidad ?? 'media'],
    );
    return res[0];
  }

  @Patch('incidencias/:id/resolver')
  async resolverIncidencia(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.ds.query(
      `UPDATE incidencias SET estado='resuelta', resuelta_at=NOW(), resuelta_por_user_id=$1, updated_at=NOW()
       WHERE id=$2 AND client_id=$3 RETURNING *`,
      [user.sub, id, user.client_id],
    );
    return res[0];
  }

  @Get('activaciones/:id/eventos')
  async getEventos(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ds.query(
      `SELECT * FROM activation_events WHERE activation_id=$1 AND client_id=$2 ORDER BY created_at DESC`,
      [id, user.client_id],
    ).catch(() => []);
  }

  @Get('activaciones/:id/reportes-avance')
  async getReportesAvance(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ds.query(
      `SELECT * FROM reportes_avance WHERE activacion_id=$1 AND client_id=$2 ORDER BY ts DESC`,
      [id, user.client_id],
    ).catch(() => []);
  }

  @Post('activaciones/:id/reportes-avance')
  async createReporteAvance(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    const res = await this.ds.query(
      `INSERT INTO reportes_avance (client_id, activacion_id, momento, observacion, persona_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (activacion_id, momento) DO UPDATE SET observacion=$4, ts=NOW()
       RETURNING *`,
      [user.client_id, id, body.momento ?? 'inicio', body.observacion ?? null, user.sub],
    );
    return res[0];
  }

  @Post('activaciones/:id/reporte-cliente/generar')
  async generarReporte(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.reportQueue.add('report', {
      client_id: user.client_id,
      activation_id: id,
      user_id: user.sub,
    }, { attempts: 2, backoff: { type: 'exponential', delay: 3000 } });
    return { queued: true, activation_id: id };
  }

  @Get('activaciones/:id/reporte-cliente')
  async getReporteCliente(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.ds.query(
      `SELECT * FROM reportes_cliente WHERE activacion_id=$1 AND client_id=$2 ORDER BY aprobado_at DESC LIMIT 1`,
      [id, user.client_id],
    ).catch(() => []);
    return rows[0] ?? null;
  }

  @Post('activaciones/:id/reporte-cliente/enviar')
  async enviarReporte(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { destinatarios: string[]; htmlReporte: string },
  ) {
    const acts = await this.ds.query(
      `SELECT a.*, c.nombre as cliente_nombre FROM activations a
       JOIN clients c ON c.id=a.client_id WHERE a.id=$1 AND a.client_id=$2`,
      [id, user.client_id],
    ).catch(() => []);

    await this.ds.query(
      `INSERT INTO reportes_cliente (client_id, activacion_id, version_cliente_jsonb, destinatarios, enviado_at, aprobado_por_user_id, aprobado_at)
       VALUES ($1,$2,$3,$4,NOW(),$5,NOW())`,
      [user.client_id, id, JSON.stringify({ html: body.htmlReporte }), body.destinatarios, user.sub],
    ).catch(() => {});

    const act = acts[0];
    const ok = await this.emailService.sendReporteCliente({
      destinatarios: body.destinatarios,
      clienteNombre: act?.cliente_nombre ?? 'Cliente',
      activacionNombre: `Activación ${act?.activation_date ?? ''}`,
      fecha: new Date().toLocaleDateString('es-CL'),
      htmlReporte: body.htmlReporte,
    });

    return { sent: ok, destinatarios: body.destinatarios };
  }

  @Patch('activaciones/:id/cerrar')
  async cerrarActivacion(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    const res = await this.ds.query(
      `UPDATE activations SET estado_f5='cerrada', cerrada_at=NOW(), cierre_jsonb=$1, status='completed', updated_at=NOW()
       WHERE id=$2 AND client_id=$3 RETURNING *`,
      [JSON.stringify(body.cierre ?? {}), id, user.client_id],
    );
    return res[0];
  }
}
