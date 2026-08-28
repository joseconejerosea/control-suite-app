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
import { EvidenceIntakeService } from './evidence-intake.service';
import { ClarificationService } from '../project-resolver/clarification.service';
import { ProjectResolverService } from '../project-resolver/project-resolver.service';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookSignatureGuard } from '../../common/guards/webhook-signature.guard';
import { constantTimeEqual } from '../../common/utils/constant-time';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { PromptShieldService } from '../../common/ai/prompt-shield.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { SenderTenantResolverService } from './sender-tenant-resolver.service';
import { WhatsAppTenantSelectionService } from './tenant-selection.service';
import { WhatsAppActionMenuService } from './action-menu.service';
import { AffiliationCodeService } from '../clients/affiliation-code.service';
import { AffiliationService } from '../clients/affiliation.service';
import { MetricsService } from '../metrics/metrics.service';

const QUEUE_OCR = 'ocr';
const QUEUE_CONVOCATORIA_CLASSIFY = 'convocatoria-classify';
const QUEUE_STOCK_RETURN_PHOTO = 'stock-return-photo';

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly wa: WhatsAppService,
    private readonly sessions: WhatsAppSessionService,
    private readonly media: WhatsAppMediaService,
    private readonly materialIntake: MaterialIntakeService,
    private readonly evidenceIntake: EvidenceIntakeService,
    private readonly clarification: ClarificationService,
    private readonly projectResolver: ProjectResolverService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUE_OCR) private readonly ocrQueue: Queue,
    @InjectQueue(QUEUE_CONVOCATORIA_CLASSIFY) private readonly convocatoriaQueue: Queue,
    @InjectQueue(QUEUE_STOCK_RETURN_PHOTO) private readonly returnPhotoQueue: Queue,
    private readonly shield: PromptShieldService,
    private readonly senderResolver: SenderTenantResolverService,
    private readonly selection: WhatsAppTenantSelectionService,
    private readonly actionMenu: WhatsAppActionMenuService,
    private readonly affiliationCode: AffiliationCodeService,
    private readonly affiliation: AffiliationService,
    private readonly metrics: MetricsService,
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

      // Single global number: every reply goes out from the one global
      // WHATSAPP_PHONE_NUMBER_ID (WhatsAppService), so there is no per-message
      // outbound context to set up here.
      const messages = value?.messages;
      if (!messages?.length) return 'ok';

      for (const rawMsg of messages) {
        const messageId = rawMsg.id as string;
        const from      = rawMsg.from as string;

        // Atomic dedup (Redis SET NX) at the very top, before any work, plus a DB
        // guard for the Redis-restart case. See WhatsAppSessionService.claimMessage.
        const fresh = await this.sessions.claimMessage(messageId);
        if (!fresh) {
          this.logger.log(`[WhatsApp] Duplicate message ${messageId} — skipping`);
          continue;
        }
        if (await this.isDuplicate(messageId)) {
          this.logger.log(`[WhatsApp] Duplicate (db) ${messageId} — skipping`);
          continue;
        }

        try {
          await (async () => {
            // Single-global-number: resolve WHICH agency (tenant) this message
            // belongs to from the SENDER, not the recipient number. May ask the
            // sender to pick an agency or type an affiliation code, buffering the
            // intake until they answer; an ongoing multi-step flow bypasses this.
            const resolution = await this.resolveInboundTenant(from, rawMsg);
            if (resolution.status !== 'proceed') return;

            const { clientId, canalId, msg, pendingMedia } = resolution;
            const dispatchMsgId = (msg?.id as string) ?? messageId;
            const msgType = msg?.type as string;
            // A resumed intake dispatches a msg id different from the one that arrived
            // in this batch (the current reply). Used to harden the resume path.
            const isResumed = dispatchMsgId !== messageId;

            this.logger.log(`[WhatsApp] From=${from} type=${msgType} msgId=${dispatchMsgId} clientId=${clientId}`);

            // A media message IS the action's content, so leave the action-menu state
            // (if any) so the follow-up reply isn't parsed as another menu choice.
            if (msgType !== 'text') await this.sessions.clearActionMenu(from);

            try {
              switch (msgType) {
                case 'image':
                  await this.handleImage(from, msg, clientId, canalId, dispatchMsgId, pendingMedia);
                  break;
                case 'audio':
                  await this.handleAudio(from, msg, clientId, canalId, dispatchMsgId, pendingMedia);
                  break;
                case 'video':
                  await this.handleVideo(from, msg, clientId, canalId, dispatchMsgId, pendingMedia);
                  break;
                case 'document':
                  await this.handleDocument(from, msg, clientId, canalId, dispatchMsgId, pendingMedia);
                  break;
                case 'location':
                  await this.handleLocation(from, msg, clientId, canalId, dispatchMsgId);
                  break;
                case 'text':
                  await this.handleText(from, msg, clientId, canalId, dispatchMsgId);
                  break;
                default:
                  this.logger.warn(`[WhatsApp] Unsupported message type: ${msgType}`);
              }
            } catch (dispatchErr: any) {
              // A resumed buffered intake must not vanish silently if dispatch throws.
              // Emit a greppable recovery marker with from + clientId, then rethrow so
              // the outer handler releases the NX claim and Meta can retry.
              if (isResumed) {
                this.logger.error(
                  `[WhatsApp] WA_RESUME_DISPATCH_FAILED from=${from} clientId=${clientId} type=${msgType}: ${dispatchErr?.message}`,
                );
              }
              throw dispatchErr;
            }
          })();
        } catch (err) {
          // Release the NX claim so Meta's retry can reprocess. Rethrow to log.
          await this.sessions.releaseMessage(messageId).catch(() => {});
          throw err;
        }
      }
    } catch (err: any) {
      this.logger.error('[WhatsApp] Webhook error:', err.message);
    }
    return 'ok';
  }

  // ── Inbound tenant resolution (single global number) ──────────────────────

  // Session states owned by ongoing multi-step flows; while one is active the
  // sender's tenant is already known (session.clientId) and must NOT be re-asked.
  private static readonly CONTINUATION_STATES = [
    'awaiting_material',
    'awaiting_evidence',
    'awaiting_clarification',
    'awaiting_project',
    'awaiting_action',
    // T3 · el ruteo por menú ya tiene client_id persistido (una foto buffereada o un
    // tipo elegido): la respuesta de texto NO debe re-preguntar la agencia.
    'awaiting_type',
    'awaiting_media',
  ];

  // Cap on invalid agency-selection / affiliation-code attempts before aborting the
  // flow. Prevents an endless ask-loop for a sender who keeps replying with garbage.
  private static readonly MAX_TENANT_SELECTION_ATTEMPTS = 5;

  // Cap for buffering media bytes into the Redis session while asking which agency.
  // Images fit comfortably; a large video/document (WhatsApp allows ~16MB) would
  // bloat one session key (base64 ≈ +33%, re-serialized on every set()), so above
  // the cap we skip pre-capture and fall back to id-based resume.
  private static readonly MAX_PRECAPTURE_BYTES = 5 * 1024 * 1024;

  // Message types that are NOT usable as a text reply to the "which agency?" /
  // "type the code" question. When one arrives mid-selection we re-prompt instead
  // of silently discarding the intake, and keep the buffered pendingMsg intact.
  private static readonly SELECTION_REPLY_TYPES = ['text'];

  /**
   * Resolves WHICH agency an inbound message belongs to from the SENDER (single
   * global number). Returns 'proceed' with the tenant + the message to dispatch
   * (the buffered intake when resuming), or 'stop' when it asked the sender a
   * question (agency choice / affiliation code) and is waiting for the reply.
   */
  private async resolveInboundTenant(
    from: string,
    incomingMsg: any,
  ): Promise<
    | {
        status: 'proceed';
        clientId: string;
        canalId: string | null;
        msg: any;
        pendingMedia?: { base64: string; mimeType: string } | null;
      }
    | { status: 'stop' }
  > {
    const session = await this.sessions.get(from);
    const text = (incomingMsg?.text?.body as string | undefined)?.trim() ?? '';
    const incomingType = incomingMsg?.type as string | undefined;
    const isUsableReply =
      WhatsAppWebhookController.SELECTION_REPLY_TYPES.includes(incomingType ?? '') && text.length > 0;

    // (0) Ongoing multi-step flow → keep its tenant; let handleText's interceptors run.
    if (
      session?.clientId &&
      WhatsAppWebhookController.CONTINUATION_STATES.includes(session.state)
    ) {
      return {
        status: 'proceed',
        clientId: session.clientId,
        canalId: session.canalId ?? null,
        msg: incomingMsg,
      };
    }

    // (1) Awaiting an affiliation code → treat the text as the code.
    if (session?.state === 'awaiting_affiliation_code' && session.tenantSelection) {
      // Anexo · escape del sub-estado "código de agencia". Sin esto, el ÚNICO modo de
      // salir era acertar un código válido o fallar 5 veces ("contactá a tu coordinador"):
      // un remitente que cayó acá por error (eligió "Otra agencia" sin querer, o es un
      // número desconocido) quedaba atrapado. Un "cancelar"/"salir" limpia la selección
      // (clearTenantSelection resetea el state a '') y corta limpio.
      if (this.isCancelIntent(text)) {
        await this.sessions.clearTenantSelection(from);
        await this.wa.sendText(from, 'Listo, cancelé eso. Escribime cuando quieras retomar. 👍');
        return { status: 'stop' };
      }
      // Non-text (media) or empty reply mid-selection: DON'T discard the intake — the
      // buffered pendingMsg stays intact. Re-prompt with a hint and count the attempt.
      if (!isUsableReply) {
        return this.rejectSelectionReply(
          from,
          session.tenantSelection,
          'awaiting_affiliation_code',
          'Escribí el código de afiliación para continuar.',
        );
      }

      const clientId = await this.affiliationCode.resolveClientByCode(text);
      if (!clientId) {
        return this.rejectSelectionReply(
          from,
          session.tenantSelection,
          'awaiting_affiliation_code',
          'Código inválido. Probá de nuevo o pedíselo a tu coordinador.',
        );
      }
      await this.affiliation.affiliate(clientId, from);
      const { pendingMsg, canalId, pendingMedia } = session.tenantSelection;
      await this.sessions.clearTenantSelection(from);
      return { status: 'proceed', clientId, canalId, msg: pendingMsg, pendingMedia };
    }

    // (2) Awaiting an agency choice → parse the numbered reply.
    if (session?.state === 'awaiting_tenant' && session.tenantSelection) {
      // Anexo · mismo escape que en el código de agencia: un "cancelar"/"salir" a mitad
      // de la elección de agencia limpia la selección y corta, en vez de re-preguntar.
      if (this.isCancelIntent(text)) {
        await this.sessions.clearTenantSelection(from);
        await this.wa.sendText(from, 'Listo, cancelé eso. Escribime cuando quieras retomar. 👍');
        return { status: 'stop' };
      }
      // Non-text (media) or empty reply mid-selection: re-prompt, keep the intake.
      if (!isUsableReply) {
        return this.rejectSelectionReply(
          from,
          session.tenantSelection,
          'awaiting_tenant',
          'Respondé con el número de la agencia.',
        );
      }

      const sel = this.selection.parseSelection(text, session.tenantSelection.candidates);
      if (sel.kind === 'invalid') {
        return this.rejectSelectionReply(
          from,
          session.tenantSelection,
          'awaiting_tenant',
          this.selection.buildPrompt(session.tenantSelection.candidates),
        );
      }
      if (sel.kind === 'other') {
        // Keep the buffered intake; switch to affiliation-code entry. Reset attempts:
        // switching to the code path is progress, not a failed attempt.
        await this.sessions.setTenantSelection(
          from,
          { ...session.tenantSelection, attempts: 0 },
          'awaiting_affiliation_code',
        );
        await this.wa.sendText(from, this.selection.buildCodePrompt());
        return { status: 'stop' };
      }
      const { pendingMsg, canalId, pendingMedia } = session.tenantSelection;
      await this.sessions.clearTenantSelection(from);
      return { status: 'proceed', clientId: sel.clientId, canalId, msg: pendingMsg, pendingMedia };
    }

    // (3) Fresh message → resolve the agencies this sender is registered in.
    let candidates: { clientId: string; clientName: string; rota: boolean }[];
    try {
      candidates = await this.senderResolver.candidatesFor(from);
    } catch (err: any) {
      // A DB error is NOT a genuine 0-candidates result: don't route the sender to the
      // affiliation-code path (which would wrongly imply "you're unregistered"). Tell
      // them to retry and stop — the message id will be released so Meta can retry.
      this.logger.error(`[WhatsApp] candidatesFor failed from=${from}: ${err.message}`);
      await this.wa.sendText(from, 'Hubo un problema, probá de nuevo en un momento.');
      return { status: 'stop' };
    }

    // Convocatoria abierta en una sola agencia → tenant inequívoco: el propio sistema
    // envió esa convocatoria (F4), así que la respuesta "sí"/"no" va directo al
    // clasificador F4 sin preguntar "¿para qué agencia?". Sólo aplica cuando EXACTAMENTE
    // una de las agencias candidatas tiene una convocatoria abierta; con 0 o 2+ la agencia
    // sigue siendo ambigua y se mantiene el comportamiento general de preguntar.
    //
    // Es una optimización best-effort: si la consulta falla no debe romper el inbound, así
    // que ante un error de DB logueamos y caemos al flujo normal de "elegí agencia".
    try {
      const openConvo = await this.senderResolver.clientsWithOpenConvocatoria(from);
      const convoCandidates = candidates.filter((c) => openConvo.includes(c.clientId));
      if (convoCandidates.length === 1) {
        return {
          status: 'proceed',
          clientId: convoCandidates[0].clientId,
          canalId: null,
          msg: incomingMsg,
        };
      }
    } catch (err: any) {
      this.logger.error(
        `[WhatsApp] clientsWithOpenConvocatoria failed from=${from}: ${err.message}`,
      );
      // Fall through to the normal ask-agency behavior — the optimization is best-effort.
    }

    // Pre-capture media BEFORE prompting: Meta media ids expire, so if we ask "which
    // agency?" and only download on resume, the id would 404 by the time they answer.
    const pendingMedia = await this.preCaptureMedia(incomingMsg);

    // P1 — Non-rotating sender with exactly one candidate: skip "¿qué agencia?" and
    // auto-proceed. Strict `=== false` so null/undefined (legacy pre-migration rows)
    // never skip — they fall through to the ask path (I-1 conservative).
    // pendingMedia rides along (JD-015: Meta media ids expire; downstream handlers need it).
    if (candidates.length === 1 && candidates[0].rota === false) {
      return {
        status: 'proceed',
        clientId: candidates[0].clientId,
        canalId: null,
        msg: incomingMsg,
        pendingMedia,
      };
    }

    if (candidates.length === 0) {
      // Unknown sender: the affiliation code routes them to exactly one agency
      // (no roster is ever disclosed).
      await this.sessions.setTenantSelection(
        from,
        { candidates: [], pendingMsg: incomingMsg, canalId: null, attempts: 0, pendingMedia },
        'awaiting_affiliation_code',
      );
      await this.wa.sendText(from, this.selection.buildCodePrompt());
      return { status: 'stop' };
    }

    // 1+ candidates: always ask — a sender may also operate for a new agency.
    await this.sessions.setTenantSelection(
      from,
      { candidates, pendingMsg: incomingMsg, canalId: null, attempts: 0, pendingMedia },
      'awaiting_tenant',
    );
    await this.wa.sendText(from, this.selection.buildPrompt(candidates));
    return { status: 'stop' };
  }

  /**
   * A reply to the "which agency?" / "type the code" question was unusable (invalid
   * selection, invalid code, or a non-text/empty message). Increments the attempt
   * counter; at the cap it clears the pending selection and aborts, otherwise it
   * persists the incremented attempts (keeping the buffered intake) and re-prompts.
   */
  private async rejectSelectionReply(
    from: string,
    selection: NonNullable<WhatsAppSession['tenantSelection']>,
    state: 'awaiting_tenant' | 'awaiting_affiliation_code',
    reprompt: string,
  ): Promise<{ status: 'stop' }> {
    const attempts = (selection.attempts ?? 0) + 1;
    if (attempts >= WhatsAppWebhookController.MAX_TENANT_SELECTION_ATTEMPTS) {
      await this.sessions.clearTenantSelection(from);
      await this.wa.sendText(from, 'Demasiados intentos. Contactá a tu coordinador.');
      return { status: 'stop' };
    }
    await this.sessions.setTenantSelection(from, { ...selection, attempts }, state);
    await this.wa.sendText(from, reprompt);
    return { status: 'stop' };
  }

  /**
   * Downloads media bytes at BUFFER time so the resume path never re-fetches from Meta
   * (media ids expire). Returns null for non-media messages or on download failure
   * (the resume path then falls back to the media id, which is the pre-existing risk,
   * not a regression). The tenant is unknown here, so we only capture bytes — storage
   * happens on resume under the chosen tenant.
   */
  private async preCaptureMedia(
    incomingMsg: any,
  ): Promise<{ base64: string; mimeType: string } | null> {
    const type = incomingMsg?.type as string | undefined;
    const mediaId =
      type === 'image' ? incomingMsg?.image?.id
      : type === 'audio' ? incomingMsg?.audio?.id
      : type === 'video' ? incomingMsg?.video?.id
      : type === 'document' ? incomingMsg?.document?.id
      : undefined;
    if (!mediaId) return null;

    try {
      const { buffer, mimeType } = await this.media.download(mediaId);
      if (buffer.length > WhatsAppWebhookController.MAX_PRECAPTURE_BYTES) {
        // Too big to hold in the session; resume will re-fetch by id (which may have
        // expired for a very slow reply — acceptable vs. bloating Redis).
        this.logger.warn(
          `[WhatsApp] media too large to pre-capture (${buffer.length} bytes) id=${mediaId} — falling back to id-based resume`,
        );
        return null;
      }
      return { base64: buffer.toString('base64'), mimeType };
    } catch (err: any) {
      this.logger.error(`[WhatsApp] pre-capture media failed id=${mediaId}: ${err.message}`);
      return null;
    }
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

  // ── Media resolution (resume-safe) ────────────────────────────────────────

  /**
   * Returns the stored media for a handler. On the tenant-selection resume path the
   * media was pre-captured at buffer time (`pendingMedia`) because Meta media ids
   * expire; we store those bytes under the now-known tenant instead of re-fetching
   * from Meta. On the fresh path (no pendingMedia) it downloads-and-stores by id.
   */
  private async resolveMedia(
    pendingMedia: { base64: string; mimeType: string } | null | undefined,
    mediaId: string | undefined,
    clientId: string,
    folder: 'documents' | 'photos' | 'reports' | 'evidence',
  ): Promise<{ storagePath: string; mimeType: string; buffer: Buffer }> {
    if (pendingMedia) {
      const buffer = Buffer.from(pendingMedia.base64, 'base64');
      return this.media.storeBuffer(buffer, pendingMedia.mimeType, clientId, folder);
    }
    if (!mediaId) {
      throw new Error('resolveMedia called without pendingMedia or a media id');
    }
    return this.media.downloadAndStore(mediaId, clientId, folder);
  }

  // ── T3 · Router determinístico de la foto por tipo (menú, no visión) ────────

  /**
   * Rutea una foto ya subida a storage según el tipo elegido por el remitente en el
   * menú. Invoca el mismo destino que corría el triage post-OCR — sólo cambia QUIÉN decide
   * el tipo. El `flow` se fija por tipo para que material/evidencia NO caigan en
   * la cola F1 "Documentos por revisar" (que filtra flow='F1'); el intake luego reescribe
   * el flow (F3_INTAKE / F5_EVID) al registrar, o queda en F3/F5 si no hay activación:
   *   factura   → flow:'F1' — OCR-read: el OcrProcessor sólo lee el texto, ya no triagea.
   *   material  → flow:'F3' — materialIntake.start.
   *   evidencia → flow:'F5' — evidenceIntake.start.
   *
   * A-002 · Si `existingEventId` viene seteado (rama media-first: la foto ya se persistió
   * con flow=null al llegar y quedó buffereada), NO inserta un evento nuevo: sólo ACTUALIZA
   * el flow de esa fila. Si no viene (rama tipo-primero: la foto llegó después de elegir el
   * tipo), persiste una fila fresca como hasta ahora. Así cada foto media-first tiene una
   * fila eventos_crudos durable desde su llegada, sin blobs huérfanos si se abandona.
   */
  private async routeByType(
    from: string,
    clientId: string,
    canalId: string | null,
    messageId: string,
    type: 'factura' | 'material' | 'evidencia',
    media: { storagePath: string; mimeType: string; caption: string },
    existingEventId?: string,
  ): Promise<void> {
    const flow = type === 'factura' ? 'F1' : type === 'material' ? 'F3' : 'F5';
    let eventId: string;
    if (existingEventId) {
      // La foto ya se persistió con flow=null al llegar (A-002). Sólo fijamos su flow por
      // tipo (RLS: el webhook es @Public → runWithTenant para que el UPDATE vea la fila).
      await runWithTenant(this.ds, clientId, () =>
        this.ds.query(`UPDATE eventos_crudos SET flow=$2, updated_at=NOW() WHERE id=$1`, [existingEventId, flow]),
      );
      eventId = existingEventId;
    } else {
      eventId = await this.persistEvent({
        clientId, canalId, messageId, from, type: 'image', flow,
        payload: {
          storage_path: media.storagePath,
          mime_type: media.mimeType,
          caption: media.caption,
        },
      });
    }

    if (type === 'factura') {
      // Routing observability: one f1_events_total per routed photo (restores the signal
      // the removed OCR-vision triage used to emit; 'factura_intake' is new to the menu router).
      this.metrics.f1EventsTotal.inc({ client_id: clientId, canal: 'whatsapp', status: 'factura_intake' });
      await this.ocrQueue.add('ocr', {
        evento_crudo_id: eventId, client_id: clientId, canal: 'whatsapp',
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
      await this.wa.sendText(from, '📎 Recibí tu foto, la estoy revisando...');
      return;
    }

    if (type === 'material') {
      this.metrics.f1EventsTotal.inc({ client_id: clientId, canal: 'whatsapp', status: 'material_intake' });
      await this.materialIntake.start({
        eventoCrudoId: eventId, phoneNumber: from, clientId, storagePath: media.storagePath,
      });
      return;
    }

    // evidencia
    this.metrics.f1EventsTotal.inc({ client_id: clientId, canal: 'whatsapp', status: 'evidence_intake' });
    await this.evidenceIntake.start({
      eventoCrudoId: eventId, phoneNumber: from, clientId, storagePath: media.storagePath,
    });
  }

  /**
   * T3/N08 · ¿Hay un intake de material/evidencia en curso? Si sí, un archivo NUEVO
   * (foto/doc/audio/video) NO debe procesarse: la foto orphanearía el registro (setAwaitingType
   * cambia state a 'awaiting_type'); un documento se procesaría como F1; audio/video guardarían
   * un blob suelto. Avisamos y frenamos. Devuelve true si bloqueó (el caller debe `return`).
   * La UBICACIÓN NO pasa por acá: es la entrada legítima del paso 'ubicacion'.
   */
  private async blockedByActiveIntake(from: string): Promise<boolean> {
    const s = await this.sessions.get(from);
    if (s?.state === 'awaiting_material' || s?.state === 'awaiting_evidence') {
      await this.wa.sendText(
        from,
        'Estás cargando un registro. Terminá los pasos que te pido acá, o escribí *cancelar* para descartarlo y empezar de nuevo. 🙌',
      );
      return true;
    }
    return false;
  }

  // ── Image handler ─────────────────────────────────────────────────────────

  private async handleImage(
    from: string, msg: any,
    clientId: string, canalId: string | null,
    messageId: string,
    pendingMedia?: { base64: string; mimeType: string } | null,
  ) {
    const imageId = msg.image?.id;
    const caption = msg.image?.caption ?? '';

    // On resume, media was pre-captured at buffer time; the Meta id has likely expired,
    // so use the pre-captured bytes and never re-download.
    if (!imageId && !pendingMedia) {
      this.logger.warn('[WhatsApp] Image without media ID');
      return;
    }

    try {
      // T3/N08 · Media a mitad de un intake en curso → bloquear (ver blockedByActiveIntake).
      if (await this.blockedByActiveIntake(from)) return;

      // ── F3 devoluciones ──────────────────────────────────────────────────
      // Si el emisor tiene una devolución pendiente esperando foto, la imagen es
      // la evidencia de la devolución (no un documento F1). Se rutea a receivePhoto
      // vía cola (la clasificación con IA no debe bloquear la respuesta a Meta).
      const returnRequestId = await this.devolucionPendienteFor(from, clientId);
      if (returnRequestId) {
        const ret = await this.resolveMedia(pendingMedia, imageId, clientId, 'evidence');
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

      const result = await this.resolveMedia(pendingMedia, imageId, clientId, 'documents');
      const media = { storagePath: result.storagePath, mimeType: result.mimeType, caption };

      // T3 · El tipo de la foto lo decide el remitente por menú, NO la visión IA.
      // Si ya eligió el tipo antes de mandar la foto (awaiting_media) → rutea directo.
      // Si no → bufferea la foto y pregunta el tipo (buildTypeMenu). El proyecto ya no
      // se resuelve acá: sin saber el tipo no tiene sentido; la rama factura lo resuelve
      // después en su propio pipeline (OCR de F1).
      const session = await this.sessions.get(from);
      if (session?.state === 'awaiting_media' && session.pendingType) {
        await this.routeByType(from, clientId, canalId, messageId, session.pendingType, media);
        await this.sessions.clearMediaFlow(from);
        return;
      }

      // Re-buffer cleanup · Si ya había una foto buffereada (segunda foto mientras
      // state='awaiting_type'), setAwaitingType va a sobreescribir bufferedMedia y
      // huerfanaría el blob previo Y su fila eventos_crudos (persistida con flow=null por
      // A-002). Antes de buffear la NUEVA, limpiamos la anterior best-effort: borramos el
      // blob y marcamos su evento 'superseded' (10 chars ≤ VARCHAR(20)) para dejar rastro
      // de auditoría sin arrastrar un blob muerto.
      if (session?.state === 'awaiting_type' && session.bufferedMedia) {
        await this.media.remove(session.bufferedMedia.storagePath).catch(() => {});
        if (session.bufferedMedia.eventId) {
          const supersededId = session.bufferedMedia.eventId;
          await runWithTenant(this.ds, clientId, () =>
            this.ds.query(
              "UPDATE eventos_crudos SET status='superseded', updated_at=NOW() WHERE id=$1",
              [supersededId],
            ),
          ).catch(() => {});
        }
      }

      // A-002 · Persistir la foto en eventos_crudos AL LLEGAR, con flow=null (columna
      // nullable) para que quede FUERA de las colas F1/F3/F5 (que filtran por flow) hasta
      // que el remitente elija el tipo. Si abandona / expira el TTL, la fila queda con
      // flow=null (auditable, sin blob huérfano) en vez de perderse el registro del subido.
      const bufferedEventId = await this.persistEvent({
        clientId, canalId, messageId, from, type: 'image', flow: null,
        payload: {
          storage_path: media.storagePath,
          mime_type: media.mimeType,
          caption: media.caption,
        },
      });
      await this.sessions.setAwaitingType(from, { ...media, eventId: bufferedEventId }, clientId, canalId);
      await this.wa.sendText(from, this.actionMenu.buildTypeMenu());
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
    pendingMedia?: { base64: string; mimeType: string } | null,
  ) {
    const audioId = msg.audio?.id;
    if (!audioId && !pendingMedia) return;

    try {
      // T3/N08 · Audio a mitad de un intake en curso → bloquear (no guardar blob suelto).
      if (await this.blockedByActiveIntake(from)) return;

      const result = await this.resolveMedia(pendingMedia, audioId, clientId, 'evidence');

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
    pendingMedia?: { base64: string; mimeType: string } | null,
  ) {
    const videoId = msg.video?.id;
    if (!videoId && !pendingMedia) return;

    try {
      // T3/N08 · Video a mitad de un intake en curso → bloquear (no guardar blob suelto).
      if (await this.blockedByActiveIntake(from)) return;

      const result = await this.resolveMedia(pendingMedia, videoId, clientId, 'evidence');

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
    pendingMedia?: { base64: string; mimeType: string } | null,
  ) {
    const docId   = msg.document?.id;
    const docName = msg.document?.filename ?? 'document';
    if (!docId && !pendingMedia) return;

    try {
      // T3/N08 · Doc a mitad de un intake en curso → bloquear (no procesarlo como F1).
      if (await this.blockedByActiveIntake(from)) return;

      const result = await this.resolveMedia(pendingMedia, docId, clientId, 'documents');
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

      // A4 · Si hay un intake de material esperando ubicación (step='ubicacion'), el pin
      // completa ese registro en vez de correr el check-in standalone. handleLocationForMaterial
      // retorna true si consumió el evento; false → no había material pendiente → check-in normal.
      const consumedByMaterial = await this.materialIntake.handleLocationForMaterial(from, lat, lng, eventId);
      if (consumedByMaterial) return;

      // A4 · Ídem para evidencia (F5): si hay un intake de evidencia esperando la
      // ubicación (step='ubicacion'), el pin cierra ese check-in en vez de correr el
      // check-in standalone. Retorna true si consumió el evento.
      const consumedByEvidence = await this.evidenceIntake.handleLocationForEvidence(from, lat, lng, eventId);
      if (consumedByEvidence) return;

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
            `Ubicacion verificada. Estas a ${Math.round(distance)}m del punto de activacion.${this.actionMenu.closingLine()}`);
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

  // T3/N08 · Un mensaje que es SOLO "cancelar" (o variantes) → intención de descartar el
  // registro en curso. Anclado (^…$) para no matchear un nombre de material que CONTENGA
  // la palabra (ej. "cancelar pedido" como nombre). Case-insensitive, tolera "!"/".".
  private static readonly CANCEL_RE =
    /^\s*(cancelar|cancel[aáo]|salir|descartar|empezar\s+de\s+nuevo)\s*[!.]*\s*$/i;

  /**
   * ¿El mensaje entero es una intención EXPLÍCITA de cancelar el intake en curso?
   * SOLO "cancelar" y variantes — deliberadamente NO incluye saludos: un "hola" suelto a
   * mitad de un registro no debe borrar el progreso (los pasos del intake lo re-preguntan,
   * ej. material step='ubicacion'). Abortar es una acción destructiva → requiere intención
   * explícita, que es exactamente lo que promete el mensaje de bloqueo de handleImage.
   */
  private isCancelIntent(text: string): boolean {
    if (!text) return false;
    return WhatsAppWebhookController.CANCEL_RE.test(text);
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

    // T3/N08 · Escape de un intake en curso. Un "cancelar" (o un saludo/menú suelto) a
    // mitad de un registro de material/evidencia ABORTA ese registro y vuelve al menú, en
    // vez de quedar atrapado. Sin esto, el bloqueo de fotos de handleImage sería una
    // trampa: las fotos no incrementan el contador de intentos del intake, así que no hay
    // otra salida. Va ANTES de los interceptores de intake (si no, el texto se comería
    // como respuesta del paso actual). Preserva el client_id (setActionMenu) para no
    // re-preguntar la agencia al reanudar.
    //
    // Matriz v1.3 · "cancelar en pasos que esperan foto": el escape también cubre
    // awaiting_media ("Mandame la foto…") y awaiting_type ("¿Qué es esta foto?"). Antes
    // solo escapaba de los pasos de TEXTO del intake; en los pasos de foto, un "cancelar"
    // caía a "No entendí"/repetía el pedido y la única salida era mandar una imagen.
    // delete() descarta también la foto buffereada (awaiting_type) y el pendingType.
    const intakeSession = await this.sessions.get(from);
    if (
      (intakeSession?.state === 'awaiting_material' ||
        intakeSession?.state === 'awaiting_evidence' ||
        intakeSession?.state === 'awaiting_media' ||
        intakeSession?.state === 'awaiting_type') &&
      this.isCancelIntent(text)
    ) {
      await this.sessions.delete(from);
      await this.sessions.setActionMenu(from, clientId);
      await this.wa.sendText(from, `Listo, cancelé ese registro. 👍\n\n${this.actionMenu.buildMenu()}`);
      return;
    }

    // Material intake (F3) — intercepta las respuestas de la conversación de
    // alta de material POP antes que cualquier otro handler.
    const materialHandled = await this.materialIntake.handleResponse(from, text);
    if (materialHandled) return;

    // Evidencia de actividad (F5) — intercepta las respuestas de la conversación de
    // alta de evidencia (checkin por foto) antes que cualquier otro handler.
    const evidenceHandled = await this.evidenceIntake.handleResponse(from, text);
    if (evidenceHandled) return;

    // Clarification flow — intercept before other handlers
    const handled = await this.clarification.handleClarificationResponse(from, text, messageId, canalId);
    if (handled) return;

    const session = await this.sessions.get(from);
    if (session?.state === 'awaiting_project') {
      await this.handleProjectSelection(from, text, session, messageId, canalId);
      return;
    }

    // ¿El remitente tiene una convocatoria abierta? (F4). Se calcula UNA sola vez y
    //    ANTES del menú porque un pedido del operador (convocatoria) tiene prioridad
    //    sobre el estado "blando" awaiting_action: un "si"/"no" no debe quedar atrapado
    //    como una opción de menú inválida y perderse.
    const hasConvocatoria = await this.tieneConvocatoriaAbierta(from, clientId);

    // ── Menú de acciones: el remitente está eligiendo "¿qué querés hacer?".
    //    Un número VÁLIDO siempre es una elección del menú (aunque haya convocatoria:
    //    un "1" no es una confirmación natural). Cualquier otra respuesta cede ante una
    //    convocatoria abierta (cae al bloque F4 de abajo) y, si no hay, re-muestra el menú.
    if (session?.state === 'awaiting_action') {
      const choice = this.actionMenu.parse(text);
      if (choice.kind !== 'invalid') {
        // T3 · Para un tipo de foto (factura/material/evidencia), además de la guía,
        //   deja la sesión esperando la foto (awaiting_media) con el tipo ya fijado, así
        //   la próxima foto rutea directo sin volver a preguntar "¿qué es esta foto?".
        //   'ubicacion' es un pin de GPS (no una foto) → sólo la guía, como hoy.
        if (choice.kind !== 'ubicacion') {
          await this.sessions.setAwaitingMedia(from, choice.kind, clientId);
        }
        await this.wa.sendText(from, this.actionMenu.buildGuide(choice.kind));
        return;
      }
      if (!hasConvocatoria) {
        await this.wa.sendText(from, `No entendí 🤔\n${this.actionMenu.buildMenu()}`);
        return;
      }
      // fall-through: la convocatoria abierta maneja la respuesta abajo.
    }

    // ── F4 Fase 2: si el sender tiene una convocatoria abierta, cualquier texto
    //    es una respuesta a la convocatoria. NO se parsea si/no acá: se persiste
    //    el evento y se delega la clasificación (confirma/rechaza/ambiguo) al
    //    processor 'convocatoria-classify' (IA con Claude, igual que F1).
    if (hasConvocatoria) {
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

    // ── T3 · Ruteo de la foto buffereada por menú. §7 (casos borde): una convocatoria
    //    abierta (F4) tiene PRIORIDAD sobre estos estados "blandos" del menú de la foto,
    //    así que estas ramas se evalúan DESPUÉS del bloque F4 de arriba. Si había
    //    convocatoria, el texto ya se fue a F4 y la foto queda buffereada (awaiting_type)
    //    hasta que se resuelva la convocatoria.

    // Hay una foto buffereada esperando el tipo (awaiting_type). El texto es la elección
    // del menú "¿Qué es esta foto?". Válido → rutea la foto buffereada ahora (reusando su
    // evento ya persistido, A-002); inválido → re-pregunta el tipo sin descartar la foto.
    if (session?.state === 'awaiting_type' && session.bufferedMedia) {
      const kind = this.actionMenu.parseType(text);
      if (kind === 'invalid') {
        await this.wa.sendText(from, `No entendí 🤔\n${this.actionMenu.buildTypeMenu()}`);
        return;
      }
      await this.routeByType(
        from, session.clientId ?? clientId, session.canalId ?? canalId, messageId,
        kind, session.bufferedMedia, session.bufferedMedia.eventId,
      );
      await this.sessions.clearMediaFlow(from);
      return;
    }

    // El remitente eligió el tipo y quedó esperando la foto (awaiting_media), pero
    // respondió con TEXTO en vez de mandarla. Re-mostramos la guía del tipo pendiente y
    // lo mantenemos en el estado "mandá la foto" en vez de rebotar al menú general (que
    // además dejaría un pendingType colgado).
    if (session?.state === 'awaiting_media' && session.pendingType) {
      await this.wa.sendText(from, this.actionMenu.buildGuide(session.pendingType));
      return;
    }

    await this.persistEvent({
      clientId, canalId, messageId, from, type: 'text', flow: null,
      payload: { text },
    });

    // Plain text, not part of any flow → offer the action menu so the sender knows what
    // they can do. Persist client_id (awaiting_action is a continuation state) so the
    // choice and the media that follows don't re-ask the agency.
    await this.sessions.setActionMenu(from, clientId);
    await this.wa.sendText(from, this.actionMenu.buildMenu());
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
   * ¿El teléfono tiene una convocatoria sin resolver Y VIGENTE? Decide si un texto
   * libre debe rutearse al clasificador F4 (Fase 2) en vez del handler genérico.
   *
   * A1 · Caducidad: el estado pendiente de una convocatoria caduca por el DÍA del
   * evento. Una convocatoria de hace semanas queda en 'enviada' para siempre; sin
   * este bound capturaría todo texto entrante (incluso un "Hola" nuevo) y lo metería
   * en una tarea vieja. Solo se considera vigente si su `dia` es hoy o futuro, con
   * 1 día de gracia (respuestas tardías / desfase de zona horaria). Pasado ese plazo,
   * el texto cae al menú principal (empieza de cero), como pide el reporte de terreno.
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
          AND c.dia >= CURRENT_DATE - INTERVAL '1 day'
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
   * del teléfono (regexp_replace(phone,'\D','','g')): el `from` de Meta llega
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
}
