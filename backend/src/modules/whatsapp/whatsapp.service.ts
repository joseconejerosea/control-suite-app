import { Injectable, Logger } from '@nestjs/common';
import { getWaFrom } from './whatsapp-send-context';

const API = 'https://graph.facebook.com/v19.0';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  private readonly token = process.env.WHATSAPP_ACCESS_TOKEN;

  /**
   * Argentina (país 54): Meta ENTREGA los mensajes entrantes con el 9 de móvil
   * (549...), pero RECHAZA el envío a ese formato con (#131030). Hay que mandar
   * SIN el 9 (54 + área + número). Verificado contra la Graph API:
   *   to=5492216205665 → 131030 ; to=542216205665 → 200 (wa_id sigue siendo 549...).
   */
  private toSendFormat(to: string): string {
    const digits = String(to).replace(/\D/g, '');
    return digits.startsWith('549') ? '54' + digits.slice(3) : digits;
  }

  /**
   * WhatsApp gap 2 — multi-tenant: resuelve el phone_number_id DESDE el cual sale
   * el mensaje. Orden: (a) el explícito pasado por el caller; (b) el del contexto
   * de tenant (seteado por el webhook con el número entrante); (c) el global de
   * env como fallback (comportamiento previo intacto).
   */
  private resolveFrom(fromPhoneNumberId?: string): string | undefined {
    return fromPhoneNumberId ?? getWaFrom() ?? this.phoneNumberId;
  }

  /**
   * R1-002 (SSRF defense) — the resolved phone_number_id is interpolated into
   * the Graph API URL, so it MUST be a plain numeric id. Anything else (a
   * spoofed value, an undefined fallback, path/host injection) would let a
   * caller redirect the request. Reject non-numeric / missing ids fail-closed.
   */
  private validFrom(from: string | undefined): string | null {
    return from && /^\d+$/.test(from) ? from : null;
  }

  async sendText(to: string, message: string, fromPhoneNumberId?: string): Promise<boolean> {
    const from = this.validFrom(this.resolveFrom(fromPhoneNumberId));
    if (!from) {
      this.logger.error(
        `[WhatsApp] Refusing sendText: invalid phone_number_id=${this.resolveFrom(fromPhoneNumberId)}`,
      );
      return false;
    }
    try {
      const res = await fetch(`${API}/${from}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: this.toSendFormat(to),
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

  async sendTemplate(
    to: string,
    templateName: string,
    params: string[],
    fromPhoneNumberId?: string,
  ): Promise<boolean> {
    const from = this.validFrom(this.resolveFrom(fromPhoneNumberId));
    if (!from) {
      this.logger.error(
        `[WhatsApp] Refusing sendTemplate: invalid phone_number_id=${this.resolveFrom(fromPhoneNumberId)}`,
      );
      return false;
    }
    try {
      const res = await fetch(`${API}/${from}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: this.toSendFormat(to),
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
    // El promotor puede no tener nombre cargado; evitar "Hola null 👋".
    const saludo = opts.nombrePromotor?.trim() ? `Hola ${opts.nombrePromotor.trim()} 👋` : 'Hola 👋';
    const msg = `${saludo}

Te convocamos para la activación *${opts.proyecto}*:

📅 Fecha: ${opts.fecha}
📍 Local: ${opts.local}
🗺 Dirección: ${opts.direccion}

Responde *SI* para confirmar o *NO* para rechazar.

Control Suite BTL ⚡`;
    return this.sendText(opts.telefono, msg);
  }

  // F1 — Confirmación de documento procesado y registrado.
  // Refleja lo que REALMENTE se procesó (tipo, proveedor, monto, proyecto, estado),
  // no una plantilla fija: el usuario de terreno debe sentir que el sistema entendió
  // su envío. Los valores llegan ya resueltos/formateados desde el persist processor.
  //
  // [Slice C / ADR-10] nuevoLine is an optional escape-hatch line appended when
  // resolver_method='single_active_project' and the sender is a MANAGER. Non-breaking:
  // callers that do not supply nuevoLine receive the original message format unchanged.
  async confirmarProcesado(opts: {
    telefono: string;
    tipo: string;
    proveedor: string;
    monto: string;
    proyecto: string;
    estado: string;
    nuevoLine?: string;
  }): Promise<boolean> {
    const nuevoSection = opts.nuevoLine ? `\n\n${opts.nuevoLine}` : '';
    const msg = `✅ *Documento procesado*

Tipo: ${opts.tipo}
Proveedor: ${opts.proveedor}
Monto: ${opts.monto}
Proyecto: ${opts.proyecto}
Estado: ${opts.estado}${nuevoSection}

Control Suite BTL ⚡`;
    return this.sendText(opts.telefono, msg);
  }

  // F1 — El documento ya estaba registrado (duplicado). Se avisa para no dejar
  // al remitente colgado tras el ack inicial "Procesando con IA…".
  async avisarDuplicado(telefono: string): Promise<boolean> {
    const msg = `ℹ️ *Documento duplicado*

Este documento ya estaba registrado, así que no lo cargamos de nuevo.

Control Suite BTL ⚡`;
    return this.sendText(telefono, msg);
  }

  // F1 — No se pudo procesar el documento (OCR ilegible, IA no clasificó, o
  // fallo de infraestructura). Mensaje seguro y genérico: no expone la causa
  // técnica y le confirma al remitente que un operador lo revisará.
  async avisarFalloProcesamiento(telefono: string): Promise<boolean> {
    const msg = `⚠️ *No pudimos procesar tu documento*

No lo pudimos leer/clasificar automáticamente. Un operador lo va a revisar.
Si era una foto, probá reenviarla más nítida y completa.

Control Suite BTL ⚡`;
    return this.sendText(telefono, msg);
  }

  // F3 — Confirmación de material POP registrado en inventario. Refleja el ítem
  // real recién creado: nombre, ID único (codigo del SKU), proyecto, bodega y cantidad.
  async confirmarMaterial(opts: {
    telefono: string;
    nombre: string;
    codigo: string;
    proyecto: string;
    bodega: string;
    cantidad: number;
  }): Promise<boolean> {
    const msg = `✅ *Material registrado*

Ítem: ${opts.nombre}
ID: ${opts.codigo}
Proyecto: ${opts.proyecto}
Bodega: ${opts.bodega}
Cantidad: ${opts.cantidad}

Control Suite BTL ⚡`;
    return this.sendText(opts.telefono, msg);
  }
}
