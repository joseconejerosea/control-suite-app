import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { WhatsAppSessionService, WhatsAppSession } from '../whatsapp/whatsapp-session.service';

// Non-null clarification sub-object shape, derived from the session union so that
// field mismatches (e.g. reading a field that does not exist on the union) are
// caught by the compiler instead of silently yielding `undefined` (JAA-001/JBA-003).
type SessionClarification = NonNullable<WhatsAppSession['clarification']>;
import { ProjectInboxService } from '../project-inbox/project-inbox.service';

const MAX_ATTEMPTS = 2;
// Cap for user-provided project names (JAA-005/JBA-008). 200 is a sane bound well
// within projects.name VARCHAR(255); prevents unbounded input from the WhatsApp reply.
const PROJECT_NAME_MAX_LENGTH = 200;

// Campos críticos que F1 puede pedir por WhatsApp cuando el OCR no los leyó.
// El orden acá define el orden en que se preguntan.
const DATA_FIELD_LABELS: Record<string, { es: string; en: string }> = {
  monto_total: {
    es: 'el MONTO TOTAL del documento (solo números, ej: 45000)',
    en: 'the TOTAL AMOUNT of the document (numbers only, e.g. 45000)',
  },
  fecha_emision: {
    es: 'la FECHA de emisión (formato DD/MM/AAAA)',
    en: 'the ISSUE DATE (format DD/MM/YYYY)',
  },
  razon_social_emisor: {
    es: 'el NOMBRE del proveedor (razón social del emisor)',
    en: 'the SUPPLIER name (issuer business name)',
  },
};

interface ClarificationRequest {
  eventoCrudoId: string;
  clientId: string;
  phoneNumber: string;
  projects: { id: string; name: string }[];
  language: string;
  // [ADR-2] When true, appends the __create__ sentinel option to the list.
  // Only set when the sender is confirmed MANAGER via canCreateProject().
  allowCreate?: boolean;
}

interface DataClarificationRequest {
  eventoCrudoId: string;
  clientId: string;
  phoneNumber: string;
  pendingFields: string[];
  language: string;
}

interface BeginProjectCreateOpts {
  eventoCrudoId: string;
  clientId: string;
  from: string;
  lang: string;
  pendingEventoIds?: string[];
  // [Slice C / ADR-10] Carried from project_create_offer → project_create for sub-case 2
  // (invoice already persisted). handleProjectCreateResponse reads this from the session
  // clarification and passes it to createDraftFromWhatsApp as reassignFacturaId.
  facturaId?: string;
}

@Injectable()
export class ClarificationService {
  private readonly logger = new Logger(ClarificationService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue('ocr') private readonly ocrQueue: Queue,
    @InjectQueue('persist') private readonly persistQueue: Queue,
    private readonly wa: WhatsAppService,
    private readonly sessions: WhatsAppSessionService,
    private readonly projectInboxService: ProjectInboxService,
  ) {}

  // ── Role gate: MANAGER-only may initiate project creation (ADR-4) ──────────

  /**
   * Returns true if the sender's phone resolves to a user with role=MANAGER
   * and is_active=true in the tenant. Fail-closed on DB error or unmapped phone.
   * Phone digit-normalization mirrors regexp_replace(phone, '\D', '', 'g') (JB2-013).
   */
  async canCreateProject(phone: string, clientId: string): Promise<boolean> {
    try {
      const digitPhone = phone.replace(/\D/g, '');
      const rows = await this.ds.query(
        `SELECT id FROM users
         WHERE regexp_replace(phone, '\\D', '', 'g') = $1
           AND client_id = $2
           AND role = 'MANAGER'
           AND is_active = true
         LIMIT 1`,
        [digitPhone, clientId],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  // ── Language lookup for MANAGER senders (ADR-5) ───────────────────────────

  /**
   * Resolves the sender language for create-flow messages.
   * Checks users.phone (digits) FIRST (covers MANAGER senders), then
   * falls back to the promoters-phone join (existing behavior for promoters).
   * The existing getUserLanguage() is NOT modified.
   */
  async getUserLanguageForCreate(
    phoneNumber: string,
    clientId: string,
  ): Promise<'es' | 'en'> {
    const digitPhone = phoneNumber.replace(/\D/g, '');

    // Primary: check users table (MANAGER phones stored here)
    const userRows = await this.ds.query(
      `SELECT language FROM users
       WHERE regexp_replace(phone, '\\D', '', 'g') = $1
         AND client_id = $2
       LIMIT 1`,
      [digitPhone, clientId],
    ).catch(() => []);
    if (userRows[0]?.language) {
      return userRows[0].language === 'en' ? 'en' : 'es';
    }

    // Fallback: promoters join (same as existing getUserLanguage)
    const promoterRows = await this.ds.query(
      `SELECT u.language FROM users u
       JOIN promoters p ON p.client_id = u.client_id
       WHERE p.phone = $1 AND p.client_id = $2
       LIMIT 1`,
      [phoneNumber, clientId],
    ).catch(() => []);
    const lang = promoterRows[0]?.language;
    return lang === 'en' ? 'en' : 'es';
  }

  // ── Project clarification (Case 2 — list with optional create sentinel) ────

  async requestProjectClarification(req: ClarificationRequest): Promise<void> {
    const { eventoCrudoId, clientId, phoneNumber, projects, language, allowCreate } = req;

    if (!projects.length) {
      this.logger.warn(`[Clarification] No projects to clarify for evento ${eventoCrudoId}`);
      return;
    }

    const options = projects.map((p, i) => ({ id: p.id, label: `${i + 1}. ${p.name}` }));

    // [ADR-2] Append the create-new sentinel when the caller confirms MANAGER role.
    if (allowCreate) {
      const n = options.length + 1;
      options.push({
        id: '__create__',
        label: `${n}. crear nuevo proyecto / create new`,
      });
    }

    const list = options.map(o => o.label).join('\n');

    const message = language === 'en'
      ? `I couldn't determine which project this document belongs to. Please reply with the number:\n\n${list}`
      : `No pude determinar a qué proyecto pertenece este documento. Responde con el número:\n\n${list}`;

    const session = await this.sessions.get(phoneNumber) ?? this.emptySession(clientId);
    // [ADR-11] INVARIANT: state and clarification set atomically.
    session.state = 'awaiting_clarification';
    session.clarification = {
      eventoCrudoId,
      type: 'project',
      attempts: 0,
      options,
    };
    await this.sessions.set(phoneNumber, session);

    await this.ds.query(
      `UPDATE eventos_crudos SET status = 'awaiting_clarification', parsed_data = COALESCE(parsed_data, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ clarification_requested_at: new Date().toISOString(), clarification_type: 'project' }), eventoCrudoId],
    );

    await this.wa.sendText(phoneNumber, message);
    this.logger.log(`[Clarification] Sent project options to ${phoneNumber} for evento ${eventoCrudoId}`);
  }

  // ── Project create flow: name collection (Case 3 + Case 2 sentinel) ────────

  /**
   * Initiates the project-name-collection sub-state.
   * [ADR-11] Atomically sets state='awaiting_clarification' in the same session write.
   * Called from:
   *  - Case 3 (0 active projects, MANAGER)
   *  - Case 2 (sender selects the __create__ sentinel)
   */
  async beginProjectCreate(opts: BeginProjectCreateOpts): Promise<void> {
    const { eventoCrudoId, clientId, from, lang, pendingEventoIds, facturaId } = opts;

    const nameRequestMsg = lang === 'en'
      ? 'What is the new project name? Please type it below.'
      : '¿Cuál es el nombre del nuevo proyecto? Escribilo a continuación.';

    const session = await this.sessions.get(from) ?? this.emptySession(clientId);
    // [ADR-11] INVARIANT: state and clarification MUST be set in the same write.
    session.state = 'awaiting_clarification';
    session.clarification = {
      eventoCrudoId,
      type: 'project_create',
      attempts: 0,
      pendingEventoIds: pendingEventoIds ?? [eventoCrudoId],
      // [Slice C] Thread facturaId from project_create_offer → project_create (sub-case 2).
      // handleProjectCreateResponse reads this and passes it to createDraftFromWhatsApp.
      ...(facturaId ? { facturaId } : {}),
    };
    await this.sessions.set(from, session);

    await this.wa.sendText(from, nameRequestMsg);
    this.logger.log(`[Clarification] beginProjectCreate: sent name-request to ${from} for evento ${eventoCrudoId}`);
  }

  // ── Handle sender's name reply ─────────────────────────────────────────────

  private async handleProjectCreateResponse(
    phoneNumber: string,
    session: WhatsAppSession,
    text: string,
    clientId: string,
  ): Promise<boolean> {
    const clarification = session.clarification as SessionClarification;
    // Cap to projects.name (VARCHAR(200)) and trim before storing/echoing (JAA-005/JBA-008).
    const name = (text ?? '').trim().slice(0, PROJECT_NAME_MAX_LENGTH);

    if (name.length < 3) {
      // Invalid name
      if (clarification.attempts < MAX_ATTEMPTS - 1) {
        clarification.attempts++;
        // [ADR-11] Keep state set while awaiting retry
        session.state = 'awaiting_clarification';
        await this.sessions.set(phoneNumber, session);

        const lang = await this.getUserLanguageForCreate(phoneNumber, clientId);
        const retryMsg = lang === 'en'
          ? 'Please provide a project name of at least 3 characters. Last attempt.'
          : 'Escribí un nombre de al menos 3 caracteres para el proyecto. Último intento.';
        await this.wa.sendText(phoneNumber, retryMsg);
        return true;
      }

      // Max attempts reached: escalate. [JAA-003] resolve language via the
      // create-flow lookup (users.phone first) so a MANAGER isn't forced to Spanish.
      const escLang = await this.getUserLanguageForCreate(phoneNumber, clientId);
      await this.escalateToOperator(clarification.eventoCrudoId, phoneNumber, clientId, escLang);
      await this.sessions.delete(phoneNumber);
      return true;
    }

    // Valid name: park evento(s) + create draft atomically, then confirm and clear.
    const pendingEventoIds: string[] = clarification.pendingEventoIds ?? [clarification.eventoCrudoId];

    // [JBA-005/JBA-004] The name-reply path reaches here from the @Public webhook with
    // no tenant GUC set. The park UPDATE and the createDraftFromWhatsApp
    // INSERT touch RLS tables (eventos_crudos, project_inbox) that read app.current_tenant.
    // Wrap both in a single runWithTenant transaction so (a) the tenant GUC is set and
    // (b) park + insert are atomic — a failed INSERT rolls back the park UPDATEs, so no
    // orphaned 'parked' evento is left behind.
    const draft = await runWithTenant(this.ds, clientId, async () => {
      // Park all pending eventos.
      // [Slice C / R-06 sub-case 2 / SCENARIO-18] When the parked evento carries a
      // facturaId (an already-persisted comprobante being re-pointed), flag it with
      // reassignment_pending=true so the reassignment is tracked. Plain Case-3 create
      // (no facturaId) does NOT get the flag.
      const parkedData: Record<string, unknown> = {
        parked_at: new Date().toISOString(),
        parked_reason: 'project_create',
        ...(clarification.facturaId ? { reassignment_pending: true } : {}),
      };
      for (const eid of pendingEventoIds) {
        await this.ds.query(
          `UPDATE eventos_crudos SET status = 'parked', parsed_data = COALESCE(parsed_data, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
          [JSON.stringify(parkedData), eid],
        );
      }

      // Create the WHATSAPP draft (READY, no extract).
      // ADR-10 sub-case 2: carry the already-persisted invoice (session field is `facturaId`).
      return this.projectInboxService.createDraftFromWhatsApp(clientId, {
        name,
        pendingEventoIds,
        ...(clarification.facturaId && { reassignFacturaId: clarification.facturaId }),
      });
    });

    // Confirm and clear session
    const lang = await this.getUserLanguageForCreate(phoneNumber, clientId);
    const confirmMsg = lang === 'en'
      ? `✅ Draft project "${name}" created. A manager will review and activate it from the web.`
      : `✅ Borrador del proyecto "${name}" creado. Un gestor lo revisará y activará desde la web.`;
    await this.wa.sendText(phoneNumber, confirmMsg);

    await this.sessions.delete(phoneNumber);
    this.logger.log(`[Clarification] Project draft created: ${draft.id} for evento(s) ${pendingEventoIds.join(',')}`);
    return true;
  }

  // ── Main clarification response dispatcher ─────────────────────────────────

  async handleClarificationResponse(
    phoneNumber: string,
    text: string,
    messageId: string,
    canalId: string | null,
  ): Promise<boolean> {
    const session = await this.sessions.get(phoneNumber);
    // [ADR-11] L97 gate: both clarification AND state must be set by the writer.
    if (!session?.clarification || session.state !== 'awaiting_clarification') {
      return false;
    }

    const { clarification } = session;

    if (clarification.type === 'project') {
      return this.handleProjectResponse(phoneNumber, text, session, messageId, canalId);
    }

    if (clarification.type === 'data') {
      return this.handleDataResponse(phoneNumber, text, session);
    }

    if (clarification.type === 'project_create') {
      return this.handleProjectCreateResponse(phoneNumber, session, text, session.clientId!);
    }

    if (clarification.type === 'project_create_offer') {
      return this.handleProjectCreateOfferResponse(phoneNumber, text, session);
    }

    return false;
  }

  // ── ADR-10 NUEVO escape: handle reply to project_create_offer ────────────────

  /**
   * Routes a sender's reply to the project_create_offer sub-state (ADR-10 / R-14(c)).
   *
   * Matching reply (/^\s*(nuevo|nueva|crear|new|create)\s*$/i):
   *   - MANAGER: transitions to project_create sub-state and begins name collection.
   *     The facturaId from the offer session is threaded through so createDraftFromWhatsApp
   *     can set raw_content.reassign_factura_id (sub-case 2 — R-14(d)).
   *   - Non-MANAGER: sends a denial/coordinator message and clears the offer. No draft.
   *
   * Non-matching reply:
   *   - Returns false immediately. The project_create_offer sub-state is NOT consumed or
   *     cleared (NFR-07). The message proceeds to the standard handleText path. The offer
   *     session expires via its Redis TTL. No dead-end, no session leak (SCENARIO-20).
   */
  private async handleProjectCreateOfferResponse(
    phoneNumber: string,
    text: string,
    session: WhatsAppSession,
  ): Promise<boolean> {
    const NUEVO_REGEX = /^\s*(nuevo|nueva|crear|new|create)\s*$/i;
    if (!NUEVO_REGEX.test(text)) {
      // Non-matching reply: do NOT consume the offer session (NFR-07 / SCENARIO-20).
      return false;
    }

    const clarification = session.clarification as SessionClarification;
    const clientId = session.clientId!;

    // Role gate (R-04, R-14(e)): only MANAGER may enter the create flow.
    const isManager = await this.canCreateProject(phoneNumber, clientId);

    if (!isManager) {
      // Non-MANAGER attempted NUEVO: send denial and clear the offer.
      const lang = await this.getUserLanguageForCreate(phoneNumber, clientId);
      const denyMsg = lang === 'en'
        ? 'Only a manager can create a new project from WhatsApp. Please contact your manager.'
        : 'Solo un gestor puede crear un proyecto nuevo desde WhatsApp. Contactá a tu gestor.';
      await this.wa.sendText(phoneNumber, denyMsg);
      await this.sessions.delete(phoneNumber);
      this.logger.log(`[Clarification] project_create_offer: NUEVO denied (non-MANAGER) for ${phoneNumber}`);
      return true;
    }

    // MANAGER: transition to project_create sub-state and begin name collection.
    // Thread facturaId through (sub-case 2 detection — R-14(d)/SCENARIO-18).
    const lang = await this.getUserLanguageForCreate(phoneNumber, clientId);
    await this.beginProjectCreate({
      eventoCrudoId: clarification.eventoCrudoId,
      clientId,
      from: phoneNumber,
      lang,
      pendingEventoIds: [clarification.eventoCrudoId],
      // Pass facturaId from the offer so the name handler can include it in the draft
      // (beginProjectCreate writes session.clarification which handleProjectCreateResponse reads).
      facturaId: clarification.facturaId,
    });

    this.logger.log(`[Clarification] project_create_offer: NUEVO accepted for ${phoneNumber} evento=${clarification.eventoCrudoId}`);
    return true;
  }

  // ── Existing project-selection handler (unchanged) ─────────────────────────

  private async handleProjectResponse(
    phoneNumber: string,
    text: string,
    session: any,
    messageId: string,
    canalId: string | null,
  ): Promise<boolean> {
    const { clarification } = session;
    const { eventoCrudoId, options } = clarification;
    const num = parseInt(text.trim());

    if (isNaN(num) || num < 1 || num > options.length) {
      clarification.attempts++;

      if (clarification.attempts >= MAX_ATTEMPTS) {
        await this.escalateToOperator(eventoCrudoId, phoneNumber, session.clientId);
        await this.sessions.delete(phoneNumber);
        return true;
      }

      await this.sessions.set(phoneNumber, session);

      const language = await this.getUserLanguage(phoneNumber, session.clientId);
      const retryMsg = language === 'en'
        ? `Invalid option. Please reply with a number between 1 and ${options.length}. Last attempt.`
        : `Opción inválida. Responde con un número entre 1 y ${options.length}. Último intento.`;
      await this.wa.sendText(phoneNumber, retryMsg);
      return true;
    }

    const selected = options[num - 1];

    // [ADR-2] If the __create__ sentinel is selected, begin the project-create flow.
    if (selected.id === '__create__') {
      const lang = await this.getUserLanguageForCreate(phoneNumber, session.clientId);
      await this.beginProjectCreate({
        eventoCrudoId,
        clientId: session.clientId,
        from: phoneNumber,
        lang,
      });
      return true;
    }

    await this.ds.query(
      `UPDATE eventos_crudos SET
        parsed_data = COALESCE(parsed_data, '{}'::jsonb) || $1::jsonb,
        status = 'queued'
      WHERE id = $2`,
      [
        JSON.stringify({
          resolved_project_id: selected.id,
          resolver_method: 'clarification_bidirectional',
          clarification_resolved_at: new Date().toISOString(),
          clarification_attempts: clarification.attempts + 1,
        }),
        eventoCrudoId,
      ],
    );

    await this.sessions.updateLastProject(phoneNumber, selected.id);
    await this.sessions.delete(phoneNumber);

    // Re-enqueue for OCR processing now that we have a project
    await this.ocrQueue.add('ocr', {
      evento_crudo_id: eventoCrudoId,
      client_id: session.clientId,
      canal: 'whatsapp',
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

    const language = await this.getUserLanguage(phoneNumber, session.clientId);
    const confirmMsg = language === 'en'
      ? `Assigned to "${selected.label.replace(/^\d+\.\s*/, '')}". Processing...`
      : `Asignado a "${selected.label.replace(/^\d+\.\s*/, '')}". Procesando...`;
    await this.wa.sendText(phoneNumber, confirmMsg);

    this.logger.log(`[Clarification] Resolved: evento ${eventoCrudoId} → project ${selected.id}`);
    return true;
  }

  // ── Data clarification (unchanged) ────────────────────────────────────────

  async requestDataClarification(req: DataClarificationRequest): Promise<void> {
    const { eventoCrudoId, clientId, phoneNumber, pendingFields, language } = req;

    const fields = pendingFields.filter((f) => DATA_FIELD_LABELS[f]);
    if (!fields.length) {
      this.logger.warn(`[Clarification] No valid data fields to clarify for evento ${eventoCrudoId}`);
      return;
    }

    const session = (await this.sessions.get(phoneNumber)) ?? this.emptySession(clientId);
    // [ADR-11] INVARIANT: state and clarification set atomically.
    session.state = 'awaiting_clarification';
    session.clientId = clientId;
    session.clarification = {
      eventoCrudoId,
      type: 'data',
      attempts: 0,
      pendingFields: fields,
      collected: {},
    };
    await this.sessions.set(phoneNumber, session);

    await this.ds.query(
      `UPDATE eventos_crudos SET status = 'awaiting_clarification', parsed_data = COALESCE(parsed_data, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ clarification_requested_at: new Date().toISOString(), clarification_type: 'data' }), eventoCrudoId],
    );

    const intro = language === 'en'
      ? "I read the document but couldn't extract some data with confidence."
      : 'Leí el documento pero no pude sacar algunos datos con seguridad.';
    await this.wa.sendText(phoneNumber, `${intro}\n\n${this.buildFieldQuestion(fields[0], language)}`);
    this.logger.log(`[Clarification] Data clarification started for evento ${eventoCrudoId} (${fields.join(',')})`);
  }

  private async handleDataResponse(
    phoneNumber: string,
    text: string,
    session: any,
  ): Promise<boolean> {
    const { clarification } = session;
    const pending: string[] = clarification.pendingFields ?? [];
    if (!pending.length) return false;

    const currentField = pending[0];
    const language = await this.getUserLanguage(phoneNumber, session.clientId);
    const normalized = this.normalizeFieldValue(currentField, text);

    if (normalized === null) {
      clarification.attempts++;

      if (clarification.attempts >= MAX_ATTEMPTS) {
        await this.escalateToOperator(clarification.eventoCrudoId, phoneNumber, session.clientId);
        await this.sessions.delete(phoneNumber);
        return true;
      }

      await this.sessions.set(phoneNumber, session);
      const retryMsg = language === 'en'
        ? `I couldn't read that. ${this.buildFieldQuestion(currentField, language)} Last attempt.`
        : `No pude leer ese dato. ${this.buildFieldQuestion(currentField, language)} Último intento.`;
      await this.wa.sendText(phoneNumber, retryMsg);
      return true;
    }

    clarification.collected = { ...(clarification.collected ?? {}), [currentField]: normalized };
    clarification.pendingFields = pending.slice(1);
    clarification.attempts = 0;

    if (clarification.pendingFields.length) {
      await this.sessions.set(phoneNumber, session);
      await this.wa.sendText(phoneNumber, this.buildFieldQuestion(clarification.pendingFields[0], language));
      return true;
    }

    await this.finalizeDataClarification(clarification.eventoCrudoId, session.clientId, clarification.collected);
    await this.sessions.delete(phoneNumber);

    const doneMsg = language === 'en'
      ? 'Got it, saved. Processing the document...'
      : 'Listo, guardado. Procesando el documento...';
    await this.wa.sendText(phoneNumber, doneMsg);

    this.logger.log(`[Clarification] Data resolved: evento ${clarification.eventoCrudoId}`);
    return true;
  }

  private buildFieldQuestion(field: string, language: string): string {
    const label = DATA_FIELD_LABELS[field];
    const which = language === 'en' ? label.en : label.es;
    return language === 'en' ? `What is ${which}?` : `¿Cuál es ${which}?`;
  }

  private normalizeFieldValue(field: string, raw: string): string | null {
    const value = (raw ?? '').trim();
    if (!value) return null;

    if (field === 'monto_total') {
      const digits = value.replace(/[^\d]/g, '');
      return digits.length ? digits : null;
    }

    if (field === 'fecha_emision') {
      const m = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (!m) return null;
      const [, d, mo, y] = m;
      const year = y.length === 2 ? `20${y}` : y;
      const dd = d.padStart(2, '0');
      const mm = mo.padStart(2, '0');
      if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
      return `${year}-${mm}-${dd}`;
    }

    if (field === 'razon_social_emisor') {
      return value.length >= 2 ? value.slice(0, 200) : null;
    }

    return value;
  }

  private async finalizeDataClarification(
    eventoCrudoId: string,
    clientId: string,
    collected: Record<string, string>,
  ): Promise<void> {
    const rows = await this.ds
      .query(`SELECT ai_classification FROM eventos_crudos WHERE id = $1`, [eventoCrudoId])
      .catch(() => []);
    const classification = rows[0]?.ai_classification ?? {};

    const corrected: Record<string, any> = { ...collected };
    if (corrected.monto_total != null) corrected.monto_total = Number(corrected.monto_total);

    classification.datos_extraidos = { ...(classification.datos_extraidos ?? {}), ...corrected };
    classification.datos_corregidos_por = 'clarification_bidireccional';

    await this.ds.query(
      `UPDATE eventos_crudos SET
        ai_classification = $1::jsonb,
        parsed_data = COALESCE(parsed_data, '{}'::jsonb) || $2::jsonb,
        status = 'queued'
      WHERE id = $3`,
      [
        JSON.stringify(classification),
        JSON.stringify({ clarification_resolved_at: new Date().toISOString(), clarification_type: 'data' }),
        eventoCrudoId,
      ],
    );

    await this.persistQueue.add(
      'persist',
      {
        evento_crudo_id: eventoCrudoId,
        client_id: clientId,
        classification,
        processing_status: 'processed',
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );
  }

  /**
   * Escalates an evento to manual review.
   * @param lang optional pre-resolved language. Create-flow callers pass the
   *   language resolved via getUserLanguageForCreate (users.phone first), so a
   *   MANAGER sender is not forced to Spanish by the promoters-only getUserLanguage
   *   (JAA-003). When omitted, falls back to the existing promoters-join lookup.
   */
  private async escalateToOperator(
    eventoCrudoId: string,
    phoneNumber: string,
    clientId: string,
    lang?: 'es' | 'en',
  ): Promise<void> {
    await this.ds.query(
      `UPDATE eventos_crudos SET
        status = 'escalated',
        parsed_data = COALESCE(parsed_data, '{}'::jsonb) || $1::jsonb
      WHERE id = $2`,
      [
        JSON.stringify({
          escalated_at: new Date().toISOString(),
          escalation_reason: 'clarification_max_attempts',
        }),
        eventoCrudoId,
      ],
    );

    const language = lang ?? (await this.getUserLanguage(phoneNumber, clientId));
    const msg = language === 'en'
      ? 'I will forward this to an operator for manual review. Thank you.'
      : 'Voy a derivar esto a un operador para revisión manual. Gracias.';
    await this.wa.sendText(phoneNumber, msg);

    this.logger.warn(`[Clarification] Escalated evento ${eventoCrudoId} after ${MAX_ATTEMPTS} failed attempts`);
  }

  // Existing getUserLanguage (promoters path — unchanged).
  private async getUserLanguage(phoneNumber: string, clientId: string): Promise<string> {
    const rows = await this.ds.query(
      `SELECT u.language FROM users u
       JOIN promoters p ON p.client_id = u.client_id
       WHERE p.phone = $1 AND p.client_id = $2
       LIMIT 1`,
      [phoneNumber, clientId],
    ).catch(() => []);
    return rows[0]?.language ?? 'es';
  }

  private emptySession(clientId: string): WhatsAppSession {
    return {
      state: '',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      clientId,
      canalId: null,
      updatedAt: new Date().toISOString(),
      clarification: null,
    };
  }
}
