import { Controller, Get, Post, Patch, Param, Body, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard, RolesGuard)
@Controller('f5')
export class F5ViewController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ── Checkins ────────────────────────────────────────────────────────────
  @Get('activaciones/:id/checkins')
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async getCheckins(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ds.query(
      `SELECT * FROM checkins WHERE activacion_id=$1 AND client_id=$2 ORDER BY ts DESC`,
      [id, user.client_id],
    );
  }

  @Post('activaciones/:id/checkins')
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async createCheckin(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { persona_id?: string; observacion?: string; foto_key?: string },
  ) {
    const rows = await this.ds.query(
      `INSERT INTO checkins (client_id, activacion_id, persona_id, observacion, foto_key)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user.client_id, id, body.persona_id ?? user.sub, body.observacion, body.foto_key],
    );
    return rows[0];
  }

  // ── Incidencias ──────────────────────────────────────────────────────────
  @Get('activaciones/:id/incidencias')
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async getIncidencias(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ds.query(
      `SELECT * FROM incidencias WHERE activacion_id=$1 AND client_id=$2 ORDER BY created_at DESC`,
      [id, user.client_id],
    );
  }

  @Post('activaciones/:id/incidencias')
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async createIncidencia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { descripcion: string; severidad?: string; categoria?: string },
  ) {
    const rows = await this.ds.query(
      `INSERT INTO incidencias (client_id, activacion_id, persona_id, descripcion, severidad, categoria)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [user.client_id, id, user.sub, body.descripcion, body.severidad ?? 'media', body.categoria],
    );
    return rows[0];
  }

  @Patch('incidencias/:id/resolver')
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async resolverIncidencia(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.ds.query(
      `UPDATE incidencias SET estado='resuelta', resuelta_at=NOW(), resuelta_por_user_id=$2, updated_at=NOW()
       WHERE id=$1 AND client_id=$3 RETURNING *`,
      [id, user.sub, user.client_id],
    );
    return rows[0];
  }

  // ── Reportes avance ──────────────────────────────────────────────────────
  @Get('activaciones/:id/reportes')
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async getReportes(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ds.query(
      `SELECT * FROM reportes_avance WHERE activacion_id=$1 AND client_id=$2 ORDER BY ts ASC`,
      [id, user.client_id],
    );
  }

  @Post('activaciones/:id/reportes')
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async createReporte(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { momento: string; observacion?: string; metricas_jsonb?: unknown },
  ) {
    const rows = await this.ds.query(
      `INSERT INTO reportes_avance (client_id, activacion_id, momento, observacion, metricas_jsonb, persona_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (activacion_id, momento) DO UPDATE SET observacion=EXCLUDED.observacion, metricas_jsonb=EXCLUDED.metricas_jsonb
       RETURNING *`,
      [user.client_id, id, body.momento, body.observacion, body.metricas_jsonb ? JSON.stringify(body.metricas_jsonb) : null, user.sub],
    );
    return rows[0];
  }

  // ── Cierre activacion ────────────────────────────────────────────────────
  // FLAG: acción destructiva (cierra activación). Restringida a MANAGER+SUPERADMIN.
  // Si se requiere que OPERATOR pueda cerrar, revisar junto al PO antes de cambiar.
  @Post('activaciones/:id/cerrar')
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  async cerrarActivacion(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { observacion?: string },
  ) {
    await this.ds.query(
      `UPDATE activations SET estado_f5='cerrada', cerrada_at=NOW(), cierre_jsonb=$3, updated_at=NOW()
       WHERE id=$1 AND client_id=$2`,
      [id, user.client_id, JSON.stringify({ cerrado_por: user.sub, observacion: body.observacion })],
    );
    return { ok: true, cerrada_at: new Date() };
  }

  // ── Dashboard terreno ────────────────────────────────────────────────────
  // FLAG: dashboard operacional (estado de activaciones + incidencias abiertas del tenant).
  // NO es KPI de negocio (facturación/rendiciones) — es estado de operaciones de terreno.
  // Se abre a OPERATOR porque el operador necesita ver el estado en tiempo real.
  // SUPERVISOR NO incluido: filtra por client_id completo, no por "lo propio" del supervisor.
  // Revisar con PO si SUPERVISOR debe ver solo sus activaciones asignadas.
  @Get('dashboard')
  @Roles(UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERADMIN)
  async dashboard(@CurrentUser() user: JwtPayload) {
    const rows = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado_f5='en_vivo' OR status='in_progress') as en_vivo,
         COUNT(*) FILTER (WHERE estado_f5='cerrada' OR status='completed') as cerradas,
         COUNT(*) FILTER (WHERE estado_f5='pendiente' OR status='scheduled') as pendientes,
         COUNT(*) as total
       FROM activations WHERE client_id=$1`,
      [user.client_id],
    );
    const incidencias = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE estado='abierta') as abiertas,
              COUNT(*) FILTER (WHERE severidad='critica' AND estado='abierta') as criticas
       FROM incidencias WHERE client_id=$1`,
      [user.client_id],
    );
    return { activaciones: rows[0], incidencias: incidencias[0] };
  }
}
