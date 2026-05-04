import { Injectable, Logger } from '@nestjs/common';

const API = 'https://graph.facebook.com/v19.0';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  private readonly token = process.env.WHATSAPP_ACCESS_TOKEN;

  async sendText(to: string, message: string): Promise<boolean> {
    try {
      const res = await fetch(`${API}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: message },
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) {
        this.logger.error('[WhatsApp] Send failed:', JSON.stringify(data));
        return false;
      }
      this.logger.log(`[WhatsApp] Sent to ${to}: ${message.slice(0, 50)}`);
      return true;
    } catch (err: any) {
      this.logger.error('[WhatsApp] Error:', err.message);
      return false;
    }
  }

  async sendTemplate(to: string, templateName: string, params: string[]): Promise<boolean> {
    try {
      const res = await fetch(`${API}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'es' },
            components: params.length ? [{
              type: 'body',
              parameters: params.map(p => ({ type: 'text', text: p })),
            }] : [],
          },
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) {
        this.logger.error('[WhatsApp] Template failed:', JSON.stringify(data));
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error('[WhatsApp] Template error:', err.message);
      return false;
    }
  }

  // F4 — Convocatoria a promotor
  async enviarConvocatoria(opts: {
    telefono: string;
    nombrePromotor: string;
    proyecto: string;
    fecha: string;
    local: string;
    direccion: string;
  }): Promise<boolean> {
    const msg = `Hola ${opts.nombrePromotor} 👋

Te convocamos para la activación *${opts.proyecto}*:

📅 Fecha: ${opts.fecha}
📍 Local: ${opts.local}
🗺 Dirección: ${opts.direccion}

Responde *SI* para confirmar o *NO* para rechazar.

Control Suite BTL ⚡`;
    return this.sendText(opts.telefono, msg);
  }

  // F5 — Notificación incidencia crítica
  async notificarIncidencia(opts: {
    telefono: string;
    activacion: string;
    descripcion: string;
    severidad: string;
  }): Promise<boolean> {
    const emoji = opts.severidad === 'critica' ? '🔴' : opts.severidad === 'alta' ? '🟠' : '🟡';
    const msg = `${emoji} *Incidencia ${opts.severidad.toUpperCase()}*

Activación: ${opts.activacion}
Descripción: ${opts.descripcion}

Revisa Control Suite para más detalles.`;
    return this.sendText(opts.telefono, msg);
  }

  // F1 — Confirmación de documento recibido
  async confirmarDocumento(opts: {
    telefono: string;
    folio: string;
    proveedor: string;
    monto: string;
  }): Promise<boolean> {
    const msg = `✅ *Documento recibido*

Folio: ${opts.folio}
Proveedor: ${opts.proveedor}
Monto: ${opts.monto}

Procesando con IA... Te avisamos cuando esté listo.

Control Suite BTL ⚡`;
    return this.sendText(opts.telefono, msg);
  }
}
