import { Injectable, Logger } from '@nestjs/common';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

@Injectable()
export class ResendEmailService {
  private readonly logger = new Logger(ResendEmailService.name);
  private readonly apiKey = process.env.RESEND_API_KEY;
  private readonly from = 'Control Suite <noreply@controlsuite.app>';

  async send(opts: EmailOptions): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn('[Email] RESEND_API_KEY not set');
      return false;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: opts.from ?? this.from,
          to: Array.isArray(opts.to) ? opts.to : [opts.to],
          subject: opts.subject,
          html: opts.html,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.error('[Email] Send failed:', err);
        return false;
      }

      this.logger.log(`[Email] Sent to ${opts.to}: ${opts.subject}`);
      return true;
    } catch (err: any) {
      this.logger.error('[Email] Error:', err.message);
      return false;
    }
  }

  async sendReporteCliente(opts: {
    destinatarios: string[];
    clienteNombre: string;
    activacionNombre: string;
    fecha: string;
    htmlReporte: string;
  }): Promise<boolean> {
    return this.send({
      to: opts.destinatarios,
      subject: `Reporte Activación — ${opts.activacionNombre} | ${opts.fecha}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #C8202C; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 20px;">Control Suite BTL</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Reporte de Activación</p>
          </div>
          <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 12px 12px;">
            <h2 style="color: #1a1a1a;">${opts.activacionNombre}</h2>
            <p style="color: #666;">Cliente: <strong>${opts.clienteNombre}</strong> | Fecha: ${opts.fecha}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
            ${opts.htmlReporte}
            <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
            <p style="color: #999; font-size: 12px;">Control Suite BTL — Plataforma de Operaciones</p>
          </div>
        </div>
      `,
    });
  }

  async sendAlertaIncidencia(opts: {
    destinatarios: string[];
    descripcion:   string;
    severidad:     string;
    activacionId:  string;
  }): Promise<boolean> {
    return this.send({
      to: opts.destinatarios,
      subject: `⚠ Incidencia ${opts.severidad.toUpperCase()} — Control Suite`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #C8202C; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 20px;">Control Suite BTL</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Alerta de Incidencia</p>
          </div>
          <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 12px 12px;">
            <p style="color: #666; margin: 0 0 8px;">Severidad: <strong style="color: #C8202C;">${opts.severidad.toUpperCase()}</strong></p>
            <p style="color: #1a1a1a; font-size: 16px;">${opts.descripcion}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
            <p style="color: #999; font-size: 12px;">Activación ${opts.activacionId} — Control Suite BTL</p>
          </div>
        </div>
      `,
    });
  }
}
