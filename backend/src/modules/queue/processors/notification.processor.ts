import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { EventoCrudo } from '../../eventos-crudos/evento-crudo.entity';
import { QUEUE_ADMIN_NOTIFICATIONS } from '../queue.constants';

@Processor(QUEUE_ADMIN_NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<{ eventoCrudoId: string; reason: string }>): Promise<void> {
    const { eventoCrudoId, reason } = job.data;

    const repo = this.dataSource.getRepository(EventoCrudo);

    // 1. Load the evento_crudo from DB
    const event = await repo.findOne({ where: { id: eventoCrudoId } });

    // 2. Log with Logger.warn — MUST be visible in production logs
    this.logger.warn(
      `[ADMIN ALERT] Event ${eventoCrudoId} — reason: ${reason} | ` +
        `client_id=${event?.client_id ?? 'null'} | ` +
        `canal_entrada_id=${event?.canal_entrada_id ?? 'null'} | ` +
        `source=${event?.source ?? 'unknown'} | ` +
        `status=${event?.status ?? 'unknown'} | ` +
        `payload_keys=${event?.payload ? Object.keys(event.payload).join(',') : 'none'}`,
    );

    // 3. Future: send email/Slack — structured logging is sufficient for now
  }
}
