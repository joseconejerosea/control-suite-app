import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class MindPropuestasService {
  private readonly logger = new Logger(MindPropuestasService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Obtener propuestas abiertas del cliente
  // ─────────────────────────────────────────────────────────────────────────
  async findActivas(clientId: string) {
    return this.ds.query(
      `SELECT * FROM mind_propuestas
       WHERE client_id=$1 AND estado='abierta'
         AND (expira_at IS NULL OR expira_at > NOW())
       ORDER BY
         CASE severidad WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
         created_at DESC`,
      [clientId],
    );
  }

  async findAll(clientId: string, limit = 50) {
    return this.ds.query(
      `SELECT * FROM mind_propuestas WHERE client_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [clientId, limit],
    );
  }

  async findOne(clientId: string, id: string) {
    const rows = await this.ds.query(
      `SELECT * FROM mind_propuestas WHERE id=$1 AND client_id=$2`, [id, clientId],
    );
    if (!rows.length) throw new NotFoundException(`Propuesta ${id} no encontrada`);
    return rows[0];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Crear propuesta (llamado desde cron o eventos)
  // ─────────────────────────────────────────────────────────────────────────
  async crear(data: {
    clientId: string;
    tipo?: string;
    perfilOrigen?: string;
    titulo: string;
    descripcion?: string;
    severidad?: string;
    accionPropuesta?: unknown;
    expiresInHours?: number;
  }) {
    const expira_at = data.expiresInHours
      ? new Date(Date.now() + data.expiresInHours * 3600_000)
      : null;

    const res = await this.ds.query(
      `INSERT INTO mind_propuestas
         (client_id, tipo, perfil_origen, titulo, descripcion, severidad, accion_propuesta, expira_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        data.clientId, data.tipo ?? 'proactivo', data.perfilOrigen ?? null,
        data.titulo, data.descripcion ?? null, data.severidad ?? 'media',
        data.accionPropuesta ? JSON.stringify(data.accionPropuesta) : null,
        expira_at,
      ],
    );
    return res[0];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Aprobar → ejecutar acción
  // ─────────────────────────────────────────────────────────────────────────
  async aprobar(clientId: string, id: string, userId: string): Promise<{ resultado: unknown }> {
    const p = await this.findOne(clientId, id);
    const accion = p.accion_propuesta as Record<string, unknown> | null;

    let resultado: unknown = { ok: true };

    if (accion) {
      resultado = await this.ejecutarAccion(clientId, accion, userId);
    }

    await this.ds.query(
      `UPDATE mind_propuestas
       SET estado='aprobada', aprobada_at=NOW(), aprobada_por_user_id=$2, updated_at=NOW()
       WHERE id=$1 AND client_id=$3`,
      [id, userId, clientId],
    );

    // Log
    await this.ds.query(
      `INSERT INTO mind_acciones_log (client_id, propuesta_id, accion_ejecutada, resultado, aprobada_por_user_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [clientId, id, JSON.stringify(accion), JSON.stringify(resultado), userId],
    );

    return { resultado };
  }

  async rechazar(clientId: string, id: string, motivo?: string): Promise<void> {
    await this.findOne(clientId, id);
    await this.ds.query(
      `UPDATE mind_propuestas
       SET estado='rechazada', rechazada_motivo=$2, updated_at=NOW()
       WHERE id=$1 AND client_id=$3`,
      [id, motivo ?? 'Rechazado por el usuario', clientId],
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dispatcher de acciones
  // ─────────────────────────────────────────────────────────────────────────
  private async ejecutarAccion(
    clientId: string,
    accion: Record<string, unknown>,
    userId: string,
  ): Promise<unknown> {
    this.logger.log(`[Mind] Ejecutando acción: ${accion.tipo} para cliente ${clientId}`);

    switch (accion.tipo) {
      case 'reasignar_presupuesto':
        return { tipo: 'reasignar_presupuesto', status: 'simulado_sin_integracion_financiera' };

      case 'enviar_recordatorio':
        // BLOQUEADO — no implementable tal cual. El action se crea con
        // `target: 'admins'` (queue/processors/mind-proactive.processor.ts:110),
        // pero un admin es `users.role='admin_cliente'` y la tabla `users` NO tiene
        // columna `phone` (ver user.entity.ts y el comentario en
        // movimientos-pop/stock-returns.service.ts: el UNION con users falla).
        // Único teléfono real disponible: `collaborators`/`promoters`.
        // Falta decisión de producto sobre el destinatario antes de cablear el envío.
        // Ver PENDIENTES-DEV.md §6 ("Mind → WhatsApp").
        return { tipo: 'enviar_recordatorio', personas: accion.persona_ids, status: 'pendiente_whatsapp' };

      case 'redactar_correo':
        return { tipo: 'redactar_correo', borrador: 'Estimado cliente, le recordamos que...', status: 'borrador_listo' };

      case 'marcar_stock_revision':
        return { tipo: 'marcar_stock_revision', sku_id: accion.sku_id, status: 'marcado' };

      default:
        return { tipo: accion.tipo, status: 'accion_no_implementada' };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // KPIs para banner dashboard
  // ─────────────────────────────────────────────────────────────────────────
  async resumenDashboard(clientId: string) {
    const res = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado='abierta' AND severidad='critica') as criticas,
         COUNT(*) FILTER (WHERE estado='abierta' AND severidad='alta') as altas,
         COUNT(*) FILTER (WHERE estado='abierta') as total_abiertas,
         COUNT(*) FILTER (WHERE estado='aprobada' AND DATE(aprobada_at)=CURRENT_DATE) as aprobadas_hoy
       FROM mind_propuestas WHERE client_id=$1`,
      [clientId],
    );
    return res[0];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Expirar propuestas viejas
  // ─────────────────────────────────────────────────────────────────────────
  async expirarAntiguas(): Promise<void> {
    const res = await this.ds.query(
      `UPDATE mind_propuestas SET estado='expirada', updated_at=NOW()
       WHERE estado='abierta' AND expira_at < NOW()
       RETURNING id`,
    );
    if (res.length) this.logger.log(`[Mind] Expiradas ${res.length} propuestas`);
  }
}
