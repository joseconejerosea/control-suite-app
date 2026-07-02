import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppSessionService, WhatsAppSession } from '../whatsapp/whatsapp-session.service';

const MAX_ATTEMPTS = 2;

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
}

interface DataClarificationRequest {
  eventoCrudoId: string;
  clientId: string;
  phoneNumber: string;
  pendingFields: string[];
  language: string;
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
  ) {}

  async requestProjectClarification(req: ClarificationRequest): Promise<void> {
    const { eventoCrudoId, clientId, phoneNumber, projects, language } = req;

    if (!projects.length) {
      this.logger.warn(`[Clarification] No projects to clarify for evento ${eventoCrudoId}`);
      return;
    }

    const options = projects.map((p, i) => ({ id: p.id, label: `${i + 1}. ${p.name}` }));
    const list = options.map(o => o.label).join('\n');

    const message = language === 'en'
      ? `I couldn't determine which project this document belongs to. Please reply with the number:\n\n${list}`
      : `No pude determinar a qué proyecto pertenece este documento. Responde con el número:\n\n${list}`;

    const session = await this.sessions.get(phoneNumber) ?? this.emptySession(clientId);
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

  async handleClarificationResponse(
    phoneNumber: string,
    text: string,
    messageId: string,
    canalId: string | null,
  ): Promise<boolean> {
    const session = await this.sessions.get(phoneNumber);
    if (!session?.clarification || session.state !== 'awaiting_clarification') {
      return false;
    }

    const { clarification } = session;
    const { eventoCrudoId, options, attempts } = clarification;

    if (clarification.type === 'project') {
      return this.handleProjectResponse(phoneNumber, text, session, messageId, canalId);
    }

    if (clarification.type === 'data') {
      return this.handleDataResponse(phoneNumber, text, session);
    }

    return false;
  }

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

  // ── Aclaración de datos (campos del OCR mal leídos) ────────────────────────
  async requestDataClarification(req: DataClarificationRequest): Promise<void> {
    const { eventoCrudoId, clientId, phoneNumber, pendingFields, language } = req;

    const fields = pendingFields.filter((f) => DATA_FIELD_LABELS[f]);
    if (!fields.length) {
      this.logger.warn(`[Clarification] No valid data fields to clarify for evento ${eventoCrudoId}`);
      return;
    }

    const session = (await this.sessions.get(phoneNumber)) ?? this.emptySession(clientId);
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

    // Respuesta ilegible → reintento, y a los MAX_ATTEMPTS se escala al operador.
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

    // Dato válido → guardar y avanzar la cola.
    clarification.collected = { ...(clarification.collected ?? {}), [currentField]: normalized };
    clarification.pendingFields = pending.slice(1);
    clarification.attempts = 0;

    if (clarification.pendingFields.length) {
      await this.sessions.set(phoneNumber, session);
      await this.wa.sendText(phoneNumber, this.buildFieldQuestion(clarification.pendingFields[0], language));
      return true;
    }

    // Todos los campos completos → mergear en la clasificación y encolar persist.
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

    // monto_total tiene que ser número para el INSERT de invoices (persist.processor).
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

  private async escalateToOperator(eventoCrudoId: string, phoneNumber: string, clientId: string): Promise<void> {
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

    const language = await this.getUserLanguage(phoneNumber, clientId);
    const msg = language === 'en'
      ? 'I will forward this to an operator for manual review. Thank you.'
      : 'Voy a derivar esto a un operador para revisión manual. Gracias.';
    await this.wa.sendText(phoneNumber, msg);

    this.logger.warn(`[Clarification] Escalated evento ${eventoCrudoId} after ${MAX_ATTEMPTS} failed attempts`);
  }

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
