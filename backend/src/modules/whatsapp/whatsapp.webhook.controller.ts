import { Controller, Get, Post, Query, Body, Logger, HttpCode, UseGuards, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService, WhatsAppSession } from './whatsapp-session.service';
import { WhatsAppMediaService } from './whatsapp-media.service';
import { MaterialIntakeService } from './material-intake.service';
import { ClarificationService } from '../project-resolver/clarification.service';
import { ProjectResolverService } from '../project-resolver/project-resolver.service';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookSignatureGuard } from '../../common/guards/webhook-signature.guard';
import { constantTimeEqual } from '../../common/utils/constant-time';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { PromptShieldService } from '../../common/ai/prompt-shield.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { runWithWaFrom } from './whatsapp-send-context';

const QUEUE_OCR = 'ocr';
const QUEUE_CONVOCATORIA_CLASSIFY = 'convocatoria-classify';
const QUEUE_STOCK_RETURN_PHOTO = 'stock-return-photo';

// F4 Fase 3 (alta urgente): dedup de la notificación al operador por número
// desconocido. Module-level (vida del proceso) para no re-avisar en cada mensaje
// del mismo número; clave `${clientId}:${from}`.
const altaUrgenteNotified = new Set<string>();

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly wa: WhatsAppService,
    private readonly sessions: WhatsAppSessionService,
    private readonly media: WhatsAppMediaService,
    private readonly materialIntake: MaterialIntakeService,
    private readonly clarification: ClarificationService,
    private readonly projectResolver: ProjectResolverService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUE_OCR) private readonly ocrQueue: Queue,
    @InjectQueue(QUEUE_CONVOCATORIA_CLASSIFY) private readonly convocatoriaQueue: Queue,
    @InjectQueue(QUEUE_STOCK_RETURN_PHOTO) private readonly returnPhotoQueue: Queue,
    private readonly shield: PromptShieldService,
  ) {}

  // ── Webhook verification (Meta challenge) ─────────────────────────────────

  @Public()
  @Get()
  verify(
    @Query('hub.mode')         mode:      string,
    @Query('hub.verify_token') token:     string,
    @Query('hub.challenge')    challenge: string,
    @Res()                     reply:     FastifyReply,
  ) {
    // Usamos @Res para devolver el challenge CRUDO. Sin esto, el
    // ResponseInterceptor global lo envuelve en { data, timestamp, path } y
    // Meta no valida (espera el challenge pelado en el body).
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken) {
      // fail-closed: sin verify token configurado no verificamos el webhook
      this.logger.error('[WhatsApp] WHATSAPP_VERIFY_TOKEN no configurado — rechazando verificación');
      reply.status(403).send('Forbidden');
      return;
    }
    if (mode === 'subscribe' && constantTimeEqual(token, verifyToken)) {
      this.logger.log('[WhatsApp] Webhook verified');
      reply.status(200).send(challenge);
      return;
    }
    reply.status(403).send('Forbidden');
  }

  // ── Incoming messages ─────────────────────────────────────────────────────

  @Public()
  @UseGuards(WebhookSignatureGuard)
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

      // WhatsApp gap 2 (multi-tenant) — el número DESDE el cual hay que responder
      // es el mismo por el que entró el mensaje. Se propaga por un AsyncLocalStorage
      // dedicado (whatsapp-send-context), NO por el tenant store: así todo sendText
      // de este procesamiento (respuesta al emisor no registrado y sub-handlers)
      // sale desde el número del cliente sin abrir ninguna transacción de DB. El
      // ALS se propaga solo a través de los runWithTenant anidados de los sub-services.
      const waFrom = value?.metadata?.phone_number_id as string | undefined;
      if (!waFrom) {
        // Sin número entrante no podemos responder desde el número del cliente;
        // getWaFrom() caerá al global de env dentro de sendText.
        this.logger.warn(
          `[WhatsApp] Missing metadata.phone_number_id — replies will fall back to the global env number (clientId=${clientId})`,
        );
      }

      const messages = value?.messages;
      if (!messages?.length) return 'ok';

      // Per-invocation cache: avoid querying the same sender twice and sending
      // multiple "not registered" replies for batch payloads from the same from.
      const senderAuthCache = new Map<string, boolean>();
      const notifiedSenders = new Set<string>();

      for (const msg of messages) {
        const messageId = msg.id as string;
        const from      = msg.from as string;
        const msgType   = msg.type as string;

        if (await this.isDuplicate(messageId)) {
          this.logger.log(`[WhatsApp] Duplicate message ${messageId} — skipping`);
          continue;
        }

        // Cada mensaje se procesa dentro del contexto de número saliente (waFrom),
        // un ALS liviano SIN transacción de DB: los sub-handlers siguen abriendo
        // sus propios runWithTenant como antes, y el ALS se propaga a través de
        // ellos para que cada sendText salga desde el número del cliente.
        await runWithWaFrom(waFrom, async () => {
          // ── Sender gate (Req 7 — togglable via env) ──────────────────────────
          if (process.env.WHATSAPP_SENDER_GATE !== 'off') {
            let authorized: boolean;
            if (senderAuthCache.has(from)) {
              authorized = senderAuthCache.get(from)!;
            } else {
              authorized = await this.isAuthorizedSender(from, clientId);
              senderAuthCache.set(from, authorized);
            }

            if (!authorized) {
              this.logger.warn(`[WhatsApp] Unauthorized sender from=${from} clientId=${clientId}`);
              if (!notifiedSenders.has(from)) {
                notifiedSenders.add(from);
                await this.wa.sendText(from, 'No estás registrado, contactá a tu coordinador.');
              }
              // F4 Fase 3 (alta urgente): en vez de sólo descartar, avisar al operador
              // que un número desconocido intenta contactar, para darlo de alta.
              await this.notificarAltaUrgente(from, clientId);
              return;
            }
          }
          // ───────────────────────────────────────────────────────────────────

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
        });
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

  // ── Sender authorization gate ─────────────────────────────────────────────

  private async isAuthorizedSender(from: string, clientId: string): Promise<boolean> {
    const digits = normalizePhone(from);
    try {
      // Actores autorizados a usar el bot por WhatsApp:
      //  - Staff (tabla promoters) y colaboradores → personas de terreno.
      //  - Usuarios con rol Manager/Operador/Supervisor (spec de roles): también
      //    registran documentos/boletas/material/novedades por WhatsApp. Super Admin
      //    y Service Lead son plataforma → NO usan el bot.
      const rows = await this.ds.query(
        `SELECT 1
         FROM promoters
         WHERE client_id = $1
           AND status = 'active'
           AND regexp_replace(phone, '\\D', '', 'g') = $2
         UNION
         SELECT 1
         FROM collaborators
         WHERE client_id = $1
           AND is_active = true
           AND regexp_replace(phone, '\\D', '', 'g') = $2
         UNION
         SELECT 1
         FROM users
         WHERE client_id = $1
           AND is_active = true
           AND role IN ($3, $4, $5)
           AND phone IS NOT NULL
           AND regexp_replace(phone, '\\D', '', 'g') = $2
         LIMIT 1`,
        [clientId, digits, UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERVISOR],
      );
      return rows.length > 0;
    } catch (err: any) {
      this.logger.error(`[WhatsApp] isAuthorizedSender error from=${from} clientId=${clientId}: ${err.message}`);
      return false; // fail-closed
    }
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
      // ── F3 devoluciones ──────────────────────────────────────────────────
      // Si el emisor tiene una devolución pendiente esperando foto, la imagen es
      // la evidencia de la devolución (no un documento F1). Se rutea a receivePhoto
      // vía cola (la clasificación con IA no debe bloquear la respuesta a Meta).
      const returnRequestId = await this.devolucionPendienteFor(from, clientId);
      if (returnRequestId) {
        const ret = await this.media.downloadAndStore(imageId, clientId, 'evidence');
        await this.persistEvent({
          clientId, canalId, messageId, from, type: 'image', flow: 'F3_RETURN',
          payload: {
            storage_path: ret.storagePath,
            mime_type: ret.mimeType,
            return_request_id: returnRequestId,
          },
        });
        await this.returnPhotoQueue.add('stock-return-photo', {
          client_id: clientId, return_request_id: returnRequestId, storage_path: ret.storagePath,
        }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
        await this.wa.sendText(from, 'Recibí la foto de tu devolución. La estamos revisando, te confirmamos en breve.');
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      const result = await this.media.downloadAndStore(imageId, clientId, 'documents');

      // Proyecto como PISTA, no interactivo. El triage documento-vs-material corre
      // async en el OcrProcessor; recién ahí, sabiendo el tipo, se pregunta lo que
      // corresponda (proyecto para documento vía classify, o el intake de material).
      // Así NO preguntamos "¿a qué proyecto pertenece este documento?" antes de
      // saber si de verdad es un documento — que es el bug que reportó el cliente.
      let projectId: string | null = null;
      const resolved = await this.projectResolver.resolve(caption, null, clientId, from);
      if (resolved && resolved.confidence >= 0.70) {
        projectId = resolved.projectId;
        await this.sessions.updateLastProject(from, projectId);
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

      await this.wa.sendText(from, '📎 Recibí tu foto, la estoy revisando...');
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

  // ── Location handler (F5 — GPS validation with Haversine) ─────────────────

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
      const eventId = await this.persistEvent({
        clientId, canalId, messageId, from, type: 'location', flow: 'F5',
        payload: { lat, lng, name, address },
      });

      const activations = await this.ds.query(
        `SELECT a.id, a.location, a.status
         FROM activations a
         WHERE a.client_id = $1
           AND a.status IN ('scheduled','in_progress')
           AND a.location IS NOT NULL
         ORDER BY a.activation_date DESC`,
        [clientId],
      ).catch(() => []);

      let matched = false;

      for (const act of activations) {
        const loc = typeof act.location === 'string' ? JSON.parse(act.location) : act.location;
        if (!loc?.lat || !loc?.lng) continue;

        const distance = this.haversine(lat, lng, loc.lat, loc.lng);
        const radius = loc.radiusMeters ?? 200;
        const locationStatus = distance <= radius ? 'VERIFIED' : 'MISMATCH';

        await this.ds.query(
          `INSERT INTO activation_events
             (client_id, activation_id, event_type, location_status, lat, lng, metadata, created_at)
           VALUES ($1, $2, 'LOCATION_CHECK', $3, $4, $5, $6::jsonb, NOW())`,
          [
            clientId, act.id, locationStatus, lat, lng,
            JSON.stringify({ distance_m: Math.round(distance), radius_m: radius, from }),
          ],
        ).catch(() => {});

        if (locationStatus === 'VERIFIED') {
          if (act.status === 'scheduled') {
            await this.ds.query(
              `UPDATE activations SET status = 'in_progress', estado_f5 = 'en_vivo', updated_at = NOW() WHERE id = $1`,
              [act.id],
            ).catch(() => {});
          }
          await this.wa.sendText(from,
            `Ubicacion verificada. Estas a ${Math.round(distance)}m del punto de activacion.`);
          matched = true;
          break;
        } else {
          await this.wa.sendText(from,
            `Ubicacion fuera del rango permitido. Distancia: ${Math.round(distance)}m (maximo: ${radius}m).`);
          matched = true;
          break;
        }
      }

      if (!matched) {
        await this.wa.sendText(from, `Ubicacion recibida (${lat.toFixed(4)}, ${lng.toFixed(4)}). No hay activacion activa para validar.`);
      }
    } catch (err: any) {
      this.logger.error(`[WhatsApp] Location handling error: ${err.message}`);
    }
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Text handler ──────────────────────────────────────────────────────────

  private async handleText(
    from: string, msg: any,
    clientId: string, canalId: string | null,
    messageId: string,
  ) {
    const text = (msg.text?.body as string | undefined)?.trim() ?? '';

    // ── PromptShield (H7) — entrypoint de usuario: tratar el texto como dato
    //    no confiable antes de pasarlo a flujos que lo alimentan a IA.
    const shield = this.shield.checkLocal(text);
    if (!shield.safe) {
      this.logger.warn(`[WhatsApp] Mensaje bloqueado por shield (${shield.category}) from=${from}`);
      await this.wa.sendText(from, 'No puedo procesar ese mensaje.');
      return;
    }

    // Material intake (F3) — intercepta las respuestas de la conversación de
    // alta de material POP antes que cualquier otro handler.
    const materialHandled = await this.materialIntake.handleResponse(from, text);
    if (materialHandled) return;

    // Clarification flow — intercept before other handlers
    const handled = await this.clarification.handleClarificationResponse(from, text, messageId, canalId);
    if (handled) return;

    const session = await this.sessions.get(from);
    if (session?.state === 'awaiting_project') {
      await this.handleProjectSelection(from, text, session, messageId, canalId);
      return;
    }

    // ── F4 Fase 2: si el sender tiene una convocatoria abierta, cualquier texto
    //    es una respuesta a la convocatoria. NO se parsea si/no acá: se persiste
    //    el evento y se delega la clasificación (confirma/rechaza/ambiguo) al
    //    processor 'convocatoria-classify' (IA con Claude, igual que F1).
    if (await this.tieneConvocatoriaAbierta(from, clientId)) {
      // Persistir el evento entrante ANTES de procesar la respuesta (invariante eventos_crudos)
      const eventId = await this.persistEvent({
        clientId, canalId, messageId, from, type: 'text', flow: 'F4',
        payload: { text, convocatoria_reply: 'pending_classification' },
      });
      await this.convocatoriaQueue.add(
        'convocatoria-classify',
        { evento_crudo_id: eventId, client_id: clientId, from, text, wa_message_id: messageId },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
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

  /**
   * ¿El teléfono tiene una convocatoria sin resolver? Decide si un texto libre
   * debe rutearse al clasificador F4 (Fase 2) en vez del handler genérico.
   */
  private async tieneConvocatoriaAbierta(from: string, clientId: string): Promise<boolean> {
    const digits = normalizePhone(from);
    // convocatorias tiene RLS y el webhook es @Public (sin contexto de tenant): sin
    // runWithTenant la query no ve la fila. Y el teléfono debe matchear por DÍGITOS
    // (el `from` de Meta llega 549... y el phone guardado tiene '+', espacios).
    const rows = await runWithTenant(this.ds, clientId, () => this.ds.query(
      `SELECT 1 FROM convocatorias c
        WHERE c.client_id=$1
          AND c.estado IN ('enviada','pendiente')
          AND c.persona_id IN (
            SELECT id FROM promoters WHERE client_id=$1 AND regexp_replace(phone,'\\D','','g')=$2 LIMIT 1
          )
        LIMIT 1`,
      [clientId, digits],
    )).catch(() => []);
    return rows.length > 0;
  }

  // ── Return photo (F3 devoluciones) ────────────────────────────────────────

  /**
   * ¿El emisor tiene una devolución pendiente esperando foto? Devuelve el id del
   * stock_return_request más reciente sin foto, o null. Se compara por DÍGITOS
   * del teléfono (igual que el gate isAuthorizedSender): el `from` de Meta llega
   * 549... y el phone guardado tiene '+', espacios, etc.
   */
  private async devolucionPendienteFor(from: string, clientId: string): Promise<string | null> {
    const digits = normalizePhone(from);
    // stock_return_requests tiene RLS y el webhook es @Public (sin contexto de tenant):
    // sin runWithTenant, RLS filtra la fila y la devolución nunca se detecta.
    const rows = await runWithTenant(this.ds, clientId, () => this.ds.query(
      `SELECT srr.id FROM stock_return_requests srr
        WHERE srr.client_id = $1
          AND srr.status = 'pending'
          AND srr.photo_key IS NULL
          AND srr.persona_id IN (
            SELECT id FROM promoters    WHERE client_id=$1 AND regexp_replace(phone,'\\D','','g')=$2
            UNION
            SELECT id FROM collaborators WHERE client_id=$1 AND regexp_replace(phone,'\\D','','g')=$2
          )
        ORDER BY srr.requested_at DESC
        LIMIT 1`,
      [clientId, digits],
    )).catch(() => []);
    return rows?.[0]?.id ?? null;
  }

  /**
   * F4 Fase 3 (alta urgente): notifica UNA vez a los operadores del tenant que un
   * número no registrado intentó escribir, para que decidan darlo de alta. El
   * evento entrante NO se persiste (el gate lo descarta) — es sólo un aviso.
   */
  private async notificarAltaUrgente(from: string, clientId: string): Promise<void> {
    const key = `${clientId}:${from}`;
    if (altaUrgenteNotified.has(key)) return;
    altaUrgenteNotified.add(key);

    const admins = await this.ds.query(
      `SELECT phone FROM users
        WHERE client_id=$1 AND role='${UserRole.MANAGER}' AND phone IS NOT NULL`,
      [clientId],
    ).catch(() => []);

    const msg = `📲 Alta urgente: el número ${from} (no registrado) intentó escribir. `
      + `Si es un promotor, dalo de alta para que pueda operar.`;
    for (const admin of admins) {
      await this.wa.sendText(admin.phone, msg).catch(() => {});
    }
    this.logger.log(`[F4] Alta urgente notificada: ${from} → ${admins.length} operadores`);
  }
}
