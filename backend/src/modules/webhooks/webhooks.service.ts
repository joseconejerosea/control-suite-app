import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { EventProducer } from '../queue/producers/event.producer';
import { EmailParser } from './parsers/email.parser';
import { GenericParser } from './parsers/generic.parser';
import { IEventParser } from './parsers/parser.interface';
import { WhatsAppParser } from './parsers/whatsapp.parser';
import { runWithTenant, runAsSystem } from '../../common/tenant/tenant-context';


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

    // ── Step 1: Look up canal_entrada (cross-tenant: aún no sabemos el tenant) ──
    const canalRows = await runAsSystem(() =>
      this.dataSource.query(
        `SELECT id, client_id, tipo FROM canal_entrada WHERE id = $1 AND is_active = true`,
        [canalEntradaId],
      ),
    );
    const canal = canalRows[0];

    // ── Step 2: Channel NOT found → sin_contexto path ─────────────────────────
    if (!canal) {
      this.logger.warn(
        `[WebhooksService] Canal not found or inactive [canalEntradaId=${canalEntradaId}] — persisting as sin_contexto`,
      );

      let sinContextoId: string;
      try {
        // client_id NULL → debe ir por el pool de sistema (RLS rechazaría el NULL).
        const rows = await runAsSystem(() =>
          this.dataSource.query(
            `INSERT INTO eventos_crudos (client_id, canal_entrada_id, payload, source, status, processed, attempts)
             VALUES (NULL, NULL, $1::jsonb, 'unknown', 'sin_contexto', false, 0)
             RETURNING id`,
            [JSON.stringify({ raw: rawBody.toString() })],
          ),
        );
        sinContextoId = rows[0].id;
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
          sinContextoId,
          `sin_contexto — canalEntradaId=${canalEntradaId} not found or inactive`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Queue error';
        this.logger.error(
          `[WebhooksService] Failed to publish admin notification for sin_contexto event [eventId=${sinContextoId}]: ${msg}`,
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

    // ── Steps 6-8: idempotencia + persistencia + publish, en la tx del tenant ──
    return runWithTenant(this.dataSource, clientId, async () => {
      // Step 6: Check idempotency
      const existing = await this.dataSource.query(
        `SELECT id FROM eventos_crudos WHERE idempotency_key = $1 LIMIT 1`,
        [idempotencyKey],
      );
      if (existing.length) {
        this.logger.log(
          `[WebhooksService] Duplicate event detected [idempotencyKey=${idempotencyKey}, existingEventId=${existing[0].id}]`,
        );
        return { received: true, duplicate: true, eventId: existing[0].id };
      }

      // Step 7: PERSIST FIRST
      let savedId: string;
      try {
        const rows = await this.dataSource.query(
          `INSERT INTO eventos_crudos
             (client_id, canal_entrada_id, payload, source, status, processed, attempts, idempotency_key)
           VALUES ($1, $2, $3::jsonb, $4, 'received', false, 0, $5)
           RETURNING id`,
          [clientId, canalEntradaId, JSON.stringify(normalizedPayload), canal.tipo, idempotencyKey],
        );
        savedId = rows[0].id;
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
        `[WebhooksService] Event persisted [eventId=${savedId}, clientId=${clientId}, status=received]`,
      );

      // Step 8: PUBLISH job
      let status = 'received';
      try {
        const job = await this.eventProducer.publishProcessEvent(savedId);
        await this.dataSource.query(
          `UPDATE eventos_crudos SET status = 'queued', queued_at = NOW(), job_id = $1 WHERE id = $2`,
          [String(job.id), savedId],
        );
        status = 'queued';
        this.logger.log(
          `[WebhooksService] Job published [eventId=${savedId}, jobId=${job.id}, status=queued]`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Queue error';
        this.logger.error(
          `[WebhooksService] Failed to publish job for event [eventId=${savedId}]: ${msg} — status stays 'received' for retry`,
        );
      }

      return { received: true, eventId: savedId, status };
    });
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
