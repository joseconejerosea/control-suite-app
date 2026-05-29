import { Controller, Get, Post, Query, Body, Logger, HttpCode } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { WhatsAppService } from './whatsapp.service';
import { Public } from '../../common/decorators/public.decorator';

const META_API  = 'https://graph.facebook.com/v19.0';
const QUEUE_OCR = 'ocr';

const sessions = new Map<string, {
  state:     'awaiting_project';
  projects:  { id: string; name: string }[];
  base64:    string;
  mimeType:  string;
  caption:   string;
  clientId:  string | null;
  canalId:   string | null;
}>();

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);
  private readonly token  =
    process.env.META_SYSTEM_USER_TOKEN ?? process.env.WHATSAPP_ACCESS_TOKEN ?? '';

  constructor(
    private readonly wa: WhatsAppService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUE_OCR) private readonly ocrQueue: Queue,
  ) {}

  @Public()
  @Get()
  verify(
    @Query('hub.mode')         mode:      string,
    @Query('hub.verify_token') token:     string,
    @Query('hub.challenge')    challenge: string,
  ) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      this.logger.log('[WhatsApp] Webhook verified');
      return parseInt(challenge);
    }
    return 'Forbidden';
  }

  @Public()
  @Post()
  @HttpCode(200)
  async handleIncoming(@Body() body: any) {
    try {
      const entry   = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;
      if (!value) return 'ok';

      const incomingPhoneNumberId: string | undefined =
        value?.metadata?.phone_number_id;

      let clientId: string | null = null;
      let canalId:  string | null = null;

      if (incomingPhoneNumberId) {
        const rows = await this.ds.query(
          `SELECT client_id, id FROM canal_entrada
           WHERE config->>'phone_number_id' = $1 AND is_active = true
           LIMIT 1`,
          [incomingPhoneNumberId],
        ).catch(() => []);

        clientId = rows?.[0]?.client_id ?? null;
        canalId  = rows?.[0]?.id ?? null;

        if (!clientId) {
          this.logger.warn(
            `[WhatsApp] No active canal for phone_number_id=${incomingPhoneNumberId}`,
          );
          return 'ok';
        }
      }

      const messages = value?.messages;
      if (!messages?.length) return 'ok';

      for (const msg of messages) {
        const from    = msg.from as string;
        const msgType = msg.type as string;
        const text    = (msg.text?.body as string | undefined)?.trim() ?? '';

        this.logger.log(`[WhatsApp] From=${from} type=${msgType} clientId=${clientId}`);

        if (msgType === 'image') {
          await this.handleImage(from, msg, clientId, canalId);
        } else if (msgType === 'text') {
          const session = sessions.get(from);
          if (session?.state === 'awaiting_project') {
            await this.handleProjectSelection(from, text, session);
          } else if (/^s[ií]$/i.test(text)) {
            await this.handleConvocatoriaReply(from, 'si');
          } else if (/^no$/i.test(text)) {
            await this.handleConvocatoriaReply(from, 'no');
          } else {
            await this.wa.sendText(
              from,
              'Hola! Envia una imagen de factura o documento para procesarla con IA.',
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.error('[WhatsApp] Webhook error:', err.message);
    }
    return 'ok';
  }

  private async handleImage(
    from:     string,
    msg:      any,
    clientId: string | null,
    canalId:  string | null,
  ) {
    const imageId = msg.image?.id as string | undefined;
    const caption = (msg.image?.caption as string | undefined) ?? '';

    if (!imageId) {
      this.logger.warn('[WhatsApp] Image received without ID');
      return;
    }

    let base64   = '';
    let mimeType = 'image/jpeg';

    try {
      const mediaRes  = await fetch(`${META_API}/${imageId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const mediaData = await mediaRes.json() as { url?: string; mime_type?: string };
      const imageUrl  = mediaData?.url ?? '';
      mimeType        = mediaData?.mime_type ?? 'image/jpeg';

      if (!imageUrl) throw new Error('No URL returned from Meta media API');

      const imgRes = await fetch(imageUrl, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const buffer = await imgRes.arrayBuffer();
      base64       = Buffer.from(buffer).toString('base64');
    } catch (e: any) {
      this.logger.error('[WhatsApp] Image download error:', e.message);
      await this.wa.sendText(from, 'No pude descargar la imagen. Por favor intenta de nuevo.');
      return;
    }

    let projects: { id: string; name: string }[] = [];
    if (clientId) {
      projects = await this.ds.query(
        `SELECT id, name FROM projects
         WHERE client_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 10`,
        [clientId],
      ).catch(() => []);
    }

    if (projects.length > 1) {
      sessions.set(from, {
        state: 'awaiting_project',
        projects, base64, mimeType, caption, clientId, canalId,
      });
      const list    = projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
      const message = `A que proyecto pertenece este documento?\n\n${list}\n\nResponde con el numero (ej: 1)`;
      await this.wa.sendText(from, message);
      return;
    }

    const projectId = projects[0]?.id ?? null;
    await this.ingestIntoF1Pipeline(from, base64, mimeType, caption, clientId, canalId, projectId);
  }

  private async handleProjectSelection(
    from:    string,
    text:    string,
    session: NonNullable<ReturnType<typeof sessions['get']>>,
  ) {
    const num = parseInt(text);
    if (isNaN(num) || num < 1 || num > session.projects.length) {
      await this.wa.sendText(from, `Responde con un numero entre 1 y ${session.projects.length}.`);
      return;
    }
    const project = session.projects[num - 1];
    sessions.delete(from);
    await this.ingestIntoF1Pipeline(
      from, session.base64, session.mimeType, session.caption,
      session.clientId, session.canalId, project.id,
    );
  }

  private async ingestIntoF1Pipeline(
    from:      string,
    base64:    string,
    mimeType:  string,
    caption:   string,
    clientId:  string | null,
    canalId:   string | null,
    projectId: string | null,
  ) {
    try {
      const result = await this.ds.query(
        `INSERT INTO eventos_crudos
           (client_id, canal_entrada_id, canal, phone_e164, source,
            payload, doc_mime_type, status, processing_status_new,
            processed, attempts, created_at, updated_at)
         VALUES
           ($1, $2, 'whatsapp', $3, 'whatsapp',
            $4::jsonb, $5, 'queued', 'queued',
            false, 0, NOW(), NOW())
         RETURNING id`,
        [
          clientId, canalId, from,
          JSON.stringify({ file_base64: base64, caption, from, project_id: projectId }),
          mimeType,
        ],
      );

      const eventoCrudoId = result[0]?.id;
      if (!eventoCrudoId) throw new Error('eventos_crudos insert returned no ID');

      await this.ocrQueue.add(
        'ocr',
        { evento_crudo_id: eventoCrudoId, client_id: clientId, canal: 'whatsapp' },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );

      this.logger.log(
        `[WhatsApp] F1 pipeline started eventoCrudoId=${eventoCrudoId} client=${clientId}`,
      );

      await this.wa.sendText(
        from,
        'Documento recibido. Procesando con IA. Te avisamos cuando este listo.',
      );
    } catch (err: any) {
      this.logger.error('[WhatsApp] F1 ingest error:', err.message);
      await this.wa.sendText(
        from,
        'Error al procesar el documento. Por favor intenta de nuevo.',
      );
    }
  }

  private async handleConvocatoriaReply(from: string, reply: 'si' | 'no') {
    const estado   = reply === 'si' ? 'confirmada' : 'rechazada';
    const texto    = reply === 'si' ? 'SI - Confirmado' : 'NO - Rechazado';
    const replyMsg = reply === 'si'
      ? 'Perfecto! Tu participacion ha sido confirmada. Nos vemos en la activacion.'
      : 'Entendido. Buscaremos otro promotor. Gracias!';

    await this.ds.query(
      `UPDATE convocatorias
       SET estado=$1, respuesta_texto=$2, respuesta_at=NOW(), updated_at=NOW()
       WHERE persona_id IN (
         SELECT id FROM promoters WHERE phone=$3 LIMIT 1
       ) AND estado='pendiente'`,
      [estado, texto, from],
    ).catch(() => {});

    await this.wa.sendText(from, replyMsg);
  }
}