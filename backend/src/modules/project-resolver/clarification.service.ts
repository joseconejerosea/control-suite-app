import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppSessionService, WhatsAppSession } from '../whatsapp/whatsapp-session.service';

const MAX_ATTEMPTS = 2;

interface ClarificationRequest {
  eventoCrudoId: string;
  clientId: string;
  phoneNumber: string;
  projects: { id: string; name: string }[];
  language: string;
}

@Injectable()
export class ClarificationService {
  private readonly logger = new Logger(ClarificationService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue('ocr') private readonly ocrQueue: Queue,
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
