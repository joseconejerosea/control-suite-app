import { Controller, Get, Post, Query, Body, Headers, Logger, HttpCode } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly wa: WhatsAppService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // Webhook verification
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      this.logger.log('[WhatsApp] Webhook verified');
      return parseInt(challenge);
    }
    return 'Forbidden';
  }

  // Incoming messages
  @Post()
  @HttpCode(200)
  async handleIncoming(@Body() body: any) {
    try {
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (!messages?.length) return 'ok';

      for (const msg of messages) {
        const from = msg.from; // phone number
        const text = msg.text?.body?.trim().toLowerCase() ?? '';
        const msgType = msg.type;

        this.logger.log(`[WhatsApp] From ${from}: ${text} (${msgType})`);

        // Save raw event
        await this.ds.query(
          `INSERT INTO eventos_crudos (canal, payload, processing_status)
           VALUES ('whatsapp', $1, 'pending')
           ON CONFLICT DO NOTHING`,
          [JSON.stringify({ from, text, type: msgType, timestamp: msg.timestamp })],
        ).catch(() => {});

        // F4 — Respuesta convocatoria
        if (text === 'si' || text === 'sí') {
          await this.ds.query(
            `UPDATE convocatorias SET estado='confirmada', respuesta_texto=$1, respuesta_at=NOW(), updated_at=NOW()
             WHERE persona_id IN (
               SELECT id FROM promoters WHERE phone=$2 LIMIT 1
             ) AND estado='pendiente'`,
            ['SI - Confirmado', from],
          ).catch(() => {});
          await this.wa.sendText(from, '✅ ¡Perfecto! Tu participación ha sido confirmada. Nos vemos en la activación.');
        } else if (text === 'no') {
          await this.ds.query(
            `UPDATE convocatorias SET estado='rechazada', respuesta_texto=$1, respuesta_at=NOW(), updated_at=NOW()
             WHERE persona_id IN (
               SELECT id FROM promoters WHERE phone=$2 LIMIT 1
             ) AND estado='pendiente'`,
            ['NO - Rechazado', from],
          ).catch(() => {});
          await this.wa.sendText(from, '❌ Entendido. Buscaremos otro promotor. ¡Gracias!');
        }

        // F3 — Imagen = movimiento POP
        if (msgType === 'image') {
          await this.wa.sendText(from, '📦 Imagen recibida. Procesando movimiento de inventario...');
        }
      }
    } catch (err: any) {
      this.logger.error('[WhatsApp] Webhook error:', err.message);
    }
    return 'ok';
  }
}
