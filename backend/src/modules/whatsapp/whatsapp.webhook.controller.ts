import { Controller, Get, Post, Query, Body, Logger, HttpCode } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService, WhatsAppSession } from './whatsapp-session.service';
import { WhatsAppMediaService } from './whatsapp-media.service';
import { ClarificationService } from '../project-resolver/clarification.service';
import { ProjectResolverService } from '../project-resolver/project-resolver.service';
import { Public } from '../../common/decorators/public.decorator';

const QUEUE_OCR = 'ocr';

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly wa: WhatsAppService,
    private readonly sessions: WhatsAppSessionService,
    private readonly media: WhatsAppMediaService,
    private readonly clarification: ClarificationService,
    private readonly projectResolver: ProjectResolverService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUE_OCR) private readonly ocrQueue: Queue,
  ) {}

  // ── Webhook verification (Meta challenge) ─────────────────────────────────

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

  // ── Incoming messages ─────────────────────────────────────────────────────

  @Public()
  @Post()
  @HttpCode(200)
  async handleIncoming(@Body() body: any) {
    try {
      const entry   = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;
      if (!value) return 'ok';

      const { clientId, canalId } = await this.resolveChannel(value);
      if (!clientId) return 'ok';

      const messages = value?.messages;
      if (!messages?.length) return 'ok';

      for (const msg of messages) {
        const messageId = msg.id as string;
        const from      = msg.from as string;
        const msgType   = msg.type as string;

        if (await this.isDuplicate(messageId)) {
          this.logger.log(`[WhatsApp] Duplicate message ${messageId} — skipping`);
          continue;
        }

        this.logger.log(`[WhatsApp] From=${from} type=${msgType} msgId=${messageId}`);

        switch (msgType) {
          case 'image':
            await this.handleImage(from, msg, clientId, canalId, messageId);
            break;
          case 'audio':
            await this.handleAudio(from, msg, clientId, canalId, messageId);
            break;
          case 'video':
            await this.handleVideo(from, msg, clientId, canalId, messageId);
            break;
          case 'document':
            await this.handleDocument(from, msg, clientId, canalId, messageId);
            break;
          case 'location':
            await this.handleLocation(from, msg, clientId, canalId, messageId);
            break;
          case 'text':
            await this.handleText(from, msg, clientId, canalId, messageId);
            break;
          default:
            this.logger.warn(`[WhatsApp] Unsupported message type: ${msgType}`);
        }
      }
    } catch (err: any) {
      this.logger.error('[WhatsApp] Webhook error:', err.message);
    }
    return 'ok';
  }

  // ── Channel resolution ────────────────────────────────────────────────────

  private async resolveChannel(value: any): Promise<{ clientId: string | null; canalId: string | null }> {
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId) return { clientId: null, canalId: null };

    const rows = await this.ds.query(
      `SELECT client_id, id FROM canal_entrada
       WHERE config->>'phone_number_id' = $1 AND is_active = true
       LIMIT 1`,
      [phoneNumberId],
    ).catch(() => []);

    const clientId = rows?.[0]?.client_id ?? null;
    const canalId  = rows?.[0]?.id ?? null;

    if (!clientId) {
      this.logger.warn(`[WhatsApp] No active canal for phone_number_id=${phoneNumberId}`);
    }

    return { clientId, canalId };
  }

  // ── Idempotency ───────────────────────────────────────────────────────────

  private async isDuplicate(messageId: string): Promise<boolean> {
    const existing = await this.ds.query(
      `SELECT id FROM eventos_crudos WHERE idempotency_key = $1 LIMIT 1`,
      [messageId],
    ).catch(() => []);
    return existing.length > 0;
  }

  // ── Persist to eventos_crudos ─────────────────────────────────────────────

  private async persistEvent(opts: {
    clientId: string | null;
    canalId: string | null;
    messageId: string;
    from: string;
    type: string;
    flow: string | null;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const result = await this.ds.query(
      `INSERT INTO eventos_crudos
         (client_id, canal_entrada_id, source, idempotency_key,
          flow, payload, status, processed, attempts,
          created_at, updated_at)
       VALUES
         ($1, $2, 'whatsapp', $3,
          $4, $5::jsonb, 'queued', false, 0,
          NOW(), NOW())
       RETURNING id`,
      [
        opts.clientId,
        opts.canalId,
        opts.messageId,
        opts.flow,
        JSON.stringify({ ...opts.payload, from: opts.from, type: opts.type }),
      ],
    );

    return result[0]?.id;
  }

  // ── Image handler ─────────────────────────────────────────────────────────

  private async handleImage(
    from: string, msg: any,
    clientId: string, canalId: string | null,
    messageId: string,
  ) {
    const imageId = msg.image?.id;
    const caption = msg.image?.caption ?? '';

    if (!imageId) {
      this.logger.warn('[WhatsApp] Image without media ID');
      return;
    }

    try {
      const result = await this.media.downloadAndStore(imageId, clientId, 'documents');

      // Use ProjectResolverService for smart project assignment
      let projectId: string | null = null;
      const resolved = await this.projectResolver.resolve(caption, null, clientId, from);
      if (resolved && resolved.confidence >= 0.70) {
        projectId = resolved.projectId;
        await this.sessions.updateLastProject(from, projectId);
      }

      // If resolver couldn't determine project, fall back to asking
      if (!projectId) {
        const projects = await this.ds.query(
          `SELECT id, name FROM projects WHERE client_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 10`,
          [clientId],
        ).catch(() => []);

        if (projects.length > 1) {
          await this.sessions.set(from, {
            state: 'awaiting_project',
            projects,
            base64: result.buffer.toString('base64'),
            mimeType: result.mimeType,
            caption,
            clientId,
            canalId,
            updatedAt: new Date().toISOString(),
          });
          const list = projects.map((p: any, i: number) => `${i + 1}. ${p.name}`).join('\n');
          await this.wa.sendText(from, `A que proyecto pertenece este documento?\n\n${list}\n\nResponde con el numero.`);
          return;
        }
        projectId = projects[0]?.id ?? null;
      }

      const eventId = await this.persistEvent({
        clientId, canalId, messageId, from, type: 'image', flow: 'F1',
        payload: {
          storage_path: result.storagePath,
          mime_type: result.mimeType,
          caption,
          project_id: projectId,
          resolver_method: resolved?.method ?? 'fallback',
        },
      });

      await this.ocrQueue.add('ocr', {
        evento_crudo_id: eventId, client_id: clientId, canal: 'whatsapp',
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

      await this.wa.sendText(from, 'Documento recibido. Procesando con IA...');
    } catch (err: any) {
      this.logger.error(`[WhatsApp] Image handling error: ${err.message}`);
      await this.wa.sendText(from, 'No pude procesar la imagen. Intenta de nuevo.');
    }
  }

  // ── Audio handler ─────────────────────────────────────────────────────────

  private async handleAudio(
    from: string, msg: any,
    clientId: string, canalId: string | null,
    messageId: string,
  ) {
    const audioId = msg.audio?.id;
    if (!audioId) return;

    try {
      const result = await this.media.downloadAndStore(audioId, clientId, 'evidence');

      await this.persistEvent({
        clientId, canalId, messageId, from, type: 'audio', flow: null,
        payload: { storage_path: result.storagePath, mime_type: result.mimeType },
      });

      await this.wa.sendText(from, 'Audio recibido y almacenado.');
    } catch (err: any) {
      this.logger.error(`[WhatsApp] Audio handling error: ${err.message}`);
      await this.wa.sendText(from, 'No pude procesar el audio. Intenta de nuevo.');
    }
  }

  // ── Video handler ─────────────────────────────────────────────────────────

  private async handleVideo(
    from: string, msg: any,
    clientId: string, canalId: string | null,
    messageId: string,
  ) {
    const videoId = msg.video?.id;
    if (!videoId) return;

    try {
      const result = await this.media.downloadAndStore(videoId, clientId, 'evidence');

      await this.persistEvent({
        clientId, canalId, messageId, from, type: 'video', flow: null,
        payload: { storage_path: result.storagePath, mime_type: result.mimeType, caption: msg.video?.caption ?? '' },
      });

      await this.wa.sendText(from, 'Video recibido y almacenado.');
    } catch (err: any) {
      this.logger.error(`[WhatsApp] Video handling error: ${err.message}`);
      await this.wa.sendText(from, 'No pude procesar el video. Intenta de nuevo.');
    }
  }

  // ── Document handler (PDF, Excel, Word) ───────────────────────────────────

  private async handleDocument(
    from: string, msg: any,
    clientId: string, canalId: string | null,
    messageId: string,
  ) {
    const docId   = msg.document?.id;
    const docName = msg.document?.filename ?? 'document';
    if (!docId) return;

    try {
      const result = await this.media.downloadAndStore(docId, clientId, 'documents');
      const caption = msg.document?.caption ?? '';

      // Use ProjectResolverService for smart project assignment
      let projectId: string | null = null;
      const resolved = await this.projectResolver.resolve(
        `${docName} ${caption}`, null, clientId, from,
      );
      if (resolved && resolved.confidence >= 0.70) {
        projectId = resolved.projectId;
        await this.sessions.updateLastProject(from, projectId);
      }

      const eventId = await this.persistEvent({
        clientId, canalId, messageId, from, type: 'document', flow: 'F1',
        payload: {
          storage_path: result.storagePath,
          mime_type: result.mimeType,
          original_name: docName,
          caption,
          project_id: projectId,
          resolver_method: resolved?.method ?? 'none',
        },
      });

      await this.ocrQueue.add('ocr', {
        evento_crudo_id: eventId, client_id: clientId, canal: 'whatsapp',
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

      await this.wa.sendText(from, `Documento "${docName}" recibido. Procesando...`);
    } catch (err: any) {
      this.logger.error(`[WhatsApp] Document handling error: ${err.message}`);
      await this.wa.sendText(from, 'No pude procesar el documento. Intenta de nuevo.');
    }
  }

  // ── Location handler (F5 — GPS validation) ───────────────────────────────

  private async handleLocation(
    from: string, msg: any,
    clientId: string, canalId: string | null,
    messageId: string,
  ) {
    const lat  = msg.location?.latitude as number | undefined;
    const lng  = msg.location?.longitude as number | undefined;
    const name = msg.location?.name ?? '';
    const address = msg.location?.address ?? '';

    if (lat == null || lng == null) return;

    try {
      await this.persistEvent({
        clientId, canalId, messageId, from, type: 'location', flow: 'F5',
        payload: { lat, lng, name, address },
      });

      await this.wa.sendText(from, `Ubicacion recibida (${lat.toFixed(4)}, ${lng.toFixed(4)}). Verificando...`);
    } catch (err: any) {
      this.logger.error(`[WhatsApp] Location handling error: ${err.message}`);
    }
  }

  // ── Text handler ──────────────────────────────────────────────────────────

  private async handleText(
    from: string, msg: any,
    clientId: string, canalId: string | null,
    messageId: string,
  ) {
    const text = (msg.text?.body as string | undefined)?.trim() ?? '';

    // Clarification flow — intercept before other handlers
    const handled = await this.clarification.handleClarificationResponse(from, text, messageId, canalId);
    if (handled) return;

    const session = await this.sessions.get(from);
    if (session?.state === 'awaiting_project') {
      await this.handleProjectSelection(from, text, session, messageId, canalId);
      return;
    }

    if (/^s[ií]$/i.test(text)) {
      await this.handleConvocatoriaReply(from, 'si');
      return;
    }
    if (/^no$/i.test(text)) {
      await this.handleConvocatoriaReply(from, 'no');
      return;
    }

    await this.persistEvent({
      clientId, canalId, messageId, from, type: 'text', flow: null,
      payload: { text },
    });

    await this.wa.sendText(from, 'Mensaje recibido. Envia una imagen o documento para procesarlo con IA.');
  }

  // ── Project selection (multi-project disambiguation) ──────────────────────

  private async handleProjectSelection(
    from: string, text: string, session: WhatsAppSession,
    messageId: string, canalId: string | null,
  ) {
    const num = parseInt(text);
    if (isNaN(num) || num < 1 || num > session.projects.length) {
      await this.wa.sendText(from, `Responde con un numero entre 1 y ${session.projects.length}.`);
      return;
    }

    const project = session.projects[num - 1];
    await this.sessions.delete(from);

    const eventId = await this.persistEvent({
      clientId: session.clientId, canalId, messageId, from, type: 'image', flow: 'F1',
      payload: {
        file_base64: session.base64,
        mime_type: session.mimeType,
        caption: session.caption,
        project_id: project.id,
      },
    });

    await this.ocrQueue.add('ocr', {
      evento_crudo_id: eventId, client_id: session.clientId, canal: 'whatsapp',
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

    await this.wa.sendText(from, `Asignado a "${project.name}". Procesando con IA...`);
  }

  // ── Convocation reply (F4) ────────────────────────────────────────────────

  private async handleConvocatoriaReply(from: string, reply: 'si' | 'no') {
    const estado   = reply === 'si' ? 'confirmada' : 'rechazada';
    const texto    = reply === 'si' ? 'SI - Confirmado' : 'NO - Rechazado';
    const replyMsg = reply === 'si'
      ? 'Perfecto! Tu participacion ha sido confirmada.'
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
