import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { ResendEmailService } from '../../common/email/resend.service';
import { OperatorNotifierService } from '../whatsapp/operator-notifier.service';
import {
  CreateCheckinDto,
  CreateIncidenciaDto,
  CreateReporteAvanceDto,
  AprobarReporteDto,
  EnviarReporteDto,
  CerrarActivacionDto,
} from './dto/f5.dto';
import { REPORTE_ESTADO_ENVIABLE } from './report.types';

// RolesGuard deja pasar los endpoints sin @Roles (checkins/incidencias de terreno
// siguen abiertos a promotores); sólo el ciclo del reporte al cliente se restringe.
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard, RolesGuard)
@Controller('v1/app/f5')
export class F5Controller {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly emailService: ResendEmailService,
    private readonly notifier: OperatorNotifierService,
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
  async createCheckin(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateCheckinDto) {
    // persona_id = SIEMPRE el usuario autenticado (no se acepta del body — H5)
    const res = await this.ds.query(
      `INSERT INTO checkins (client_id, activacion_id, persona_id, observacion) VALUES ($1,$2,$3,$4) RETURNING *`,
      [user.client_id, id, user.sub, body.observacion ?? null],
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
  async createIncidencia(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateIncidenciaDto) {
    const res = await this.ds.query(
      `INSERT INTO incidencias (client_id, activacion_id, persona_id, descripcion, categoria, severidad)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [user.client_id, id, user.sub, body.descripcion, body.categoria ?? 'general', body.severidad ?? 'media'],
    );
    const incidencia = res[0];

    // F5 Fase 3: novedad crítica → avisar al operador (process map: "notifica en cada novedad").
    if ((body.severidad ?? 'media') === 'alta') {
      const msg = `🔴 Incidencia ALTA en activación ${id}: ${body.descripcion}`;
      await this.notifier.notificar(user.client_id, msg, `f5-incidencia:${incidencia.id}`).catch(() => {});

      // Además, alerta por email al cliente. Hoy resuelve al admin_cliente del tenant
      // (no hay email de marca persistido en `clients`); migrar cuando exista ese campo.
      const emails = await this.getAdminEmails(user.client_id);
      if (emails.length) {
        await this.emailService.sendAlertaIncidencia({
          destinatarios: emails,
          descripcion:   body.descripcion,
          severidad:     body.severidad ?? 'alta',
          activacionId:  id,
        }).catch(() => {});
      }
    }
    return incidencia;
  }

  /** Emails de los admin_cliente del tenant con correo registrado. */
  private async getAdminEmails(clientId: string): Promise<string[]> {
    const rows = await this.ds.query(
      `SELECT email FROM users
        WHERE client_id=$1 AND role='${UserRole.MANAGER}' AND email IS NOT NULL`,
      [clientId],
    ).catch(() => []);
    return rows.map((r: { email: string }) => r.email);
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
  async createReporteAvance(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateReporteAvanceDto) {
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
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async generarReporte(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    // Lock de edición post-aprobación: si ya hay un reporte APROBADO pendiente de
    // envío, no se regenera (evita que un borrador nuevo compita con lo aprobado).
    // Enviá o descartá el aprobado antes de regenerar.
    const [pendiente] = await this.ds.query(
      `SELECT id FROM reportes_cliente
        WHERE activacion_id=$1 AND client_id=$2
          AND estado='aprobado' AND enviado_at IS NULL
        LIMIT 1`,
      [id, user.client_id],
    ).catch(() => []);
    if (pendiente) {
      throw new ConflictException('Ya hay un reporte aprobado pendiente de envío. Envialo o descartalo antes de regenerar.');
    }

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

  // ── F5 Fase 2 (GATE): preview → aprobar (gate humano) → enviar ────────────

  @Get('activaciones/:id/reporte-cliente/preview')
  async previewReporte(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    // Último reporte de la activación (borrador o aprobado) para revisión humana.
    const rows = await this.ds.query(
      `SELECT * FROM reportes_cliente
        WHERE activacion_id=$1 AND client_id=$2
        ORDER BY created_at DESC LIMIT 1`,
      [id, user.client_id],
    ).catch(() => []);
    return rows[0] ?? null;
  }

  @Post('activaciones/:id/reporte-cliente/aprobar')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  async aprobarReporte(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AprobarReporteDto,
  ) {
    // GATE HUMANO server-side: aprueba el último BORRADOR ligando la aprobación al
    // contenido revisado (htmlReporte queda guardado). Sin borrador → 409.
    const rows = await this.ds.query(
      `UPDATE reportes_cliente
          SET estado='aprobado',
              aprobado_por_user_id=$1, aprobado_at=NOW(),
              version_cliente_jsonb = jsonb_set(COALESCE(version_cliente_jsonb,'{}'), '{html}', $2::jsonb),
              updated_at=NOW()
        WHERE id = (
          SELECT id FROM reportes_cliente
           WHERE activacion_id=$3 AND client_id=$4 AND estado='borrador'
           ORDER BY created_at DESC LIMIT 1
        )
        RETURNING *`,
      [user.sub, JSON.stringify(body.htmlReporte), id, user.client_id],
    );
    if (!rows[0]) {
      throw new ConflictException('No hay un borrador para aprobar. Generá el reporte primero.');
    }
    return rows[0];
  }

  @Post('activaciones/:id/reporte-cliente/enviar')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  async enviarReporte(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EnviarReporteDto,
  ) {
    // Sólo se envía un reporte APROBADO y aún no enviado. El contenido es el que se
    // guardó al aprobar — NUNCA del request. Sin reporte aprobado → 409.
    const [rep] = await this.ds.query(
      `SELECT rc.*, c.nombre AS cliente_nombre, a.activation_date
         FROM reportes_cliente rc
         JOIN activations a ON a.id = rc.activacion_id
         JOIN clients c     ON c.id = rc.client_id
        WHERE rc.activacion_id=$1 AND rc.client_id=$2
          AND rc.estado=$3 AND rc.enviado_at IS NULL
        ORDER BY rc.aprobado_at DESC LIMIT 1`,
      [id, user.client_id, REPORTE_ESTADO_ENVIABLE],
    ).catch(() => []);

    if (!rep) {
      throw new ConflictException('No hay un reporte aprobado para enviar. Aprobalo primero.');
    }
    const html = rep.version_cliente_jsonb?.html;
    if (!html) {
      throw new ConflictException('El reporte aprobado no tiene contenido para enviar.');
    }

    const ok = await this.emailService.sendReporteCliente({
      destinatarios: body.destinatarios,
      clienteNombre: rep.cliente_nombre ?? 'Cliente',
      activacionNombre: `Activación ${rep.activation_date ?? ''}`,
      fecha: new Date().toLocaleDateString('es-CL'),
      htmlReporte: html,
    });

    // Sólo marcamos ENVIADO si el email realmente salió — si falla, queda 'aprobado'
    // para reintentar (no perdemos el gate ni marcamos un envío que no ocurrió).
    if (!ok) {
      // Compensación: el operador tiene que enterarse de que el envío falló.
      const msgFalla = `⚠️ Falló el envío del reporte de la activación ${id}. Quedó APROBADO — reintentá el envío.`;
      await this.notifier.notificar(user.client_id, msgFalla, `f5-envio-fallo:${rep.id}`).catch(() => {});
      return { sent: false, destinatarios: body.destinatarios };
    }

    await this.ds.query(
      `UPDATE reportes_cliente
          SET estado='enviado', enviado_at=NOW(), destinatarios=$1, updated_at=NOW()
        WHERE id=$2 AND client_id=$3`,
      [body.destinatarios, rep.id, user.client_id],
    );

    // F5 Fase 3: process map — "avisa cuando se envió".
    const msgEnviado = `📤 Reporte de la activación ${id} enviado al cliente (${body.destinatarios.length} destinatario/s).`;
    await this.notifier.notificar(user.client_id, msgEnviado, `f5-enviado:${rep.id}`).catch(() => {});

    return { sent: true, destinatarios: body.destinatarios };
  }

  @Patch('activaciones/:id/cerrar')
  async cerrarActivacion(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() body: CerrarActivacionDto) {
    // H6: idempotencia + precondición de estado. Solo cierra si NO está ya
    // cerrada ni cancelada. Si no matchea ninguna fila → o no existe, o ya
    // estaba cerrada/cancelada: rechazamos con 409 en vez de re-cerrar.
    const res = await this.ds.query(
      `UPDATE activations SET estado_f5='cerrada', cerrada_at=NOW(), cierre_jsonb=$1, status='completed', updated_at=NOW()
       WHERE id=$2 AND client_id=$3 AND estado_f5 IS DISTINCT FROM 'cerrada' AND status <> 'cancelled' RETURNING *`,
      [JSON.stringify(body.cierre ?? {}), id, user.client_id],
    );
    if (!res[0]) {
      throw new ConflictException('La activación no existe, o ya está cerrada o cancelada.');
    }
    return res[0];
  }
}
