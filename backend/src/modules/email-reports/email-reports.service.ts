import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class EmailReportsService {
  private readonly logger = new Logger(EmailReportsService.name);
  private readonly resendApiKey = process.env.RESEND_API_KEY;
  private readonly fromEmail = 'Control Suite <noreply@controlsuite.app>';

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async enviarReporteCliente(params: {
    clientId: string;
    activacionId: string;
    destinatarios: string[];
    userId: string;
  }): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      // Get activacion data
      const rows = await this.ds.query(
        `SELECT a.*, c.nombre as campaign_nombre
         FROM activations a
         LEFT JOIN campaigns c ON c.id = a.campaign_id
         WHERE a.id = $1 AND a.client_id = $2`,
        [params.activacionId, params.clientId],
      );

      if (!rows.length) return { ok: false, error: 'Activación no encontrada' };
      const act = rows[0];

      // Get incidencias
      const incidencias = await this.ds.query(
        `SELECT descripcion, severidad, estado FROM incidencias WHERE activacion_id = $1`,
        [params.activacionId],
      );

      // Get checkins count
      const checkins = await this.ds.query(
        `SELECT COUNT(*) as total FROM checkins WHERE activacion_id = $1`,
        [params.activacionId],
      );

      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #C8202C;">Reporte de Activación — Control Suite</h2>
          <p><strong>Campaña:</strong> ${act.campaign_nombre ?? '—'}</p>
          <p><strong>Fecha:</strong> ${act.activation_date ?? act.start_date ?? '—'}</p>
          <p><strong>Estado:</strong> ${act.estado_f5 ?? act.status}</p>
          <hr/>
          <h3>Resumen</h3>
          <p>✅ Check-ins registrados: <strong>${checkins[0]?.total ?? 0}</strong></p>
          <p>⚠ Incidencias: <strong>${incidencias.length}</strong></p>
          ${incidencias.length ? `
          <h3>Incidencias</h3>
          <ul>
            ${incidencias.map((i: any) => `<li><strong>${i.severidad}</strong>: ${i.descripcion} (${i.estado})</li>`).join('')}
          </ul>` : ''}
          <hr/>
          <p style="color: #666; font-size: 12px;">Este reporte fue generado automáticamente por Control Suite BTL.</p>
        </div>
      `;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: params.destinatarios,
          subject: `Reporte Activación — ${act.campaign_nombre ?? 'Control Suite'}`,
          html,
        }),
      });

      const data = await res.json() as any;

      if (!res.ok) {
        this.logger.error(`[EmailReports] Resend error: ${JSON.stringify(data)}`);
        return { ok: false, error: data.message };
      }

      // Save reporte
      await this.ds.query(
        `INSERT INTO reportes_cliente (client_id, activacion_id, version_cliente_jsonb, enviado_at, destinatarios)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT DO NOTHING`,
        [params.clientId, params.activacionId, JSON.stringify({ incidencias, checkins: checkins[0]?.total }), params.destinatarios],
      ).catch(() => {});

      this.logger.log(`[EmailReports] Sent to ${params.destinatarios.join(', ')}`);
      return { ok: true, messageId: data.id };
    } catch (err: any) {
      this.logger.error(`[EmailReports] Error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  async enviarAlertaIncidencia(params: {
    destinatarios: string[];
    descripcion: string;
    severidad: string;
    activacionId: string;
  }): Promise<void> {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: params.destinatarios,
          subject: `⚠ Incidencia ${params.severidad.toUpperCase()} — Control Suite`,
          html: `<p><strong>Severidad:</strong> ${params.severidad}</p><p>${params.descripcion}</p>`,
        }),
      });
    } catch (err: any) {
      this.logger.error(`[EmailReports] Alert error: ${err.message}`);
    }
  }
}
