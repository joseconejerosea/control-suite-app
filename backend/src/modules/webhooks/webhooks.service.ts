import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { CanalEntrada } from '../canal-entrada/canal-entrada.entity';
import { EventoCrudo } from '../eventos-crudos/evento-crudo.entity';
import { EventProducer } from '../queue/producers/event.producer';
import { EmailParser } from './parsers/email.parser';
import { GenericParser } from './parsers/generic.parser';
import { IEventParser } from './parsers/parser.interface';
import { WhatsAppParser } from './parsers/whatsapp.parser';


@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly eventProducer: EventProducer,
  ) {}

  async ingest(
    canalEntradaId: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    this.logger.log(
      `[WebhooksService] Event received [canalEntradaId=${canalEntradaId}]`,
    );

    const canalRepo = this.dataSource.getRepository(CanalEntrada);
    const eventoRepo = this.dataSource.getRepository(EventoCrudo);

    // ── Step 1: Look up canal_entrada ─────────────────────────────────────────
    const canal = await canalRepo.findOne({
      where: { id: canalEntradaId, is_active: true },
    });

    // ── Step 2: Channel NOT found → sin_contexto path ─────────────────────────
    if (!canal) {
      this.logger.warn(
        `[WebhooksService] Canal not found or inactive [canalEntradaId=${canalEntradaId}] — persisting as sin_contexto`,
      );

      let sinContextoEvent: EventoCrudo;
      try {
        const newEvent = eventoRepo.create({
          client_id: null,
          canal_entrada_id: null,
          payload: { raw: rawBody.toString() },
          source: 'unknown',
          status: 'sin_contexto',
          processed: false,
          error_message: null,
          queued_at: null,
          processed_at: null,
          job_id: null,
          attempts: 0,
          idempotency_key: null,
        });
        sinContextoEvent = await eventoRepo.save(newEvent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'DB error';
        this.logger.error(
          `[WebhooksService] Failed to persist sin_contexto event: ${msg}`,
        );
        throw new InternalServerErrorException(
          'Could not persist event — please retry',
        );
      }

      try {
        await this.eventProducer.publishAdminNotification(
          sinContextoEvent.id,
          `sin_contexto — canalEntradaId=${canalEntradaId} not found or inactive`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Queue error';
        this.logger.error(
          `[WebhooksService] Failed to publish admin notification for sin_contexto event [eventId=${sinContextoEvent.id}]: ${msg}`,
        );
      }

      return { received: true, status: 'sin_contexto' };
    }

    // ── Step 3: Resolve client_id ─────────────────────────────────────────────
    const clientId: string = canal.client_id;

    // ── Step 4: Select parser based on canal tipo ─────────────────────────────
    const parser: IEventParser = this.selectParser(canal.tipo);

    // ── Step 5: Parse and normalize payload ───────────────────────────────────
    const { normalizedPayload, idempotencySource } = parser.parse(
      rawBody,
      headers,
    );

    const idempotencyKey = createHash('sha256')
      .update(canal.tipo + idempotencySource + JSON.stringify(normalizedPayload))
      .digest('hex');

    this.logger.log(
      `[WebhooksService] Event received [canalEntradaId=${canalEntradaId}, source=${canal.tipo}]`,
    );

    // ── Step 6: Check idempotency ─────────────────────────────────────────────
    const existing = await eventoRepo.findOne({
      where: { idempotency_key: idempotencyKey },
      select: { id: true },
    });

    if (existing) {
      this.logger.log(
        `[WebhooksService] Duplicate event detected [idempotencyKey=${idempotencyKey}, existingEventId=${existing.id}]`,
      );
      return { received: true, duplicate: true, eventId: existing.id };
    }

    // ── Step 7: PERSIST FIRST ─────────────────────────────────────────────────
    let savedEvent: EventoCrudo;
    try {
      const newEvent = eventoRepo.create({
        client_id: clientId,
        canal_entrada_id: canalEntradaId,
        payload: normalizedPayload,
        source: canal.tipo,
        status: 'received',
        processed: false,
        error_message: null,
        queued_at: null,
        processed_at: null,
        job_id: null,
        attempts: 0,
        idempotency_key: idempotencyKey,
      });
      savedEvent = await eventoRepo.save(newEvent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'DB error';
      this.logger.error(
        `[WebhooksService] Failed to persist event [canalEntradaId=${canalEntradaId}]: ${msg}`,
      );
      throw new InternalServerErrorException(
        'Could not persist event — please retry',
      );
    }

    this.logger.log(
      `[WebhooksService] Event persisted [eventId=${savedEvent.id}, clientId=${clientId}, status=received]`,
    );

    // ── Step 8: PUBLISH job ───────────────────────────────────────────────────
    try {
      const job = await this.eventProducer.publishProcessEvent(savedEvent.id);

      await eventoRepo.update(
        { id: savedEvent.id },
        {
          status: 'queued',
          queued_at: new Date(),
          job_id: String(job.id),
        },
      );

      savedEvent.status = 'queued';

      this.logger.log(
        `[WebhooksService] Job published [eventId=${savedEvent.id}, jobId=${job.id}, status=queued]`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Queue error';
      this.logger.error(
        `[WebhooksService] Failed to publish job for event [eventId=${savedEvent.id}]: ${msg} — status stays 'received' for retry`,
      );
    }

    // ── Step 9 REMOVED ────────────────────────────────────────────────────────
    // The F1 BullMQ pipeline (OCR → classify → persist) is the ONLY path for
    // invoice creation (Brief Rule 04). A second direct extraction here caused
    // guaranteed duplicates. The queue handles everything.

    return {
      received: true,
      eventId: savedEvent.id,
      status: savedEvent.status,
    };
  }

  private selectParser(tipo: string): IEventParser {
    switch (tipo) {
      case 'whatsapp':
        return new WhatsAppParser();
      case 'email':
        return new EmailParser();
      default:
        return new GenericParser();
    }
  }
}