import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { EventoCrudo } from '../../eventos-crudos/evento-crudo.entity';
import { EventProducer } from '../producers/event.producer';
import { QUEUE_EVENT_PROCESSING } from '../queue.constants';
import { SAFE_MESSAGES } from '../../../common/exceptions';

@Processor(QUEUE_EVENT_PROCESSING)
export class EventProcessor extends WorkerHost {
  private readonly logger = new Logger(EventProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventProducer: EventProducer,
  ) {
    super();
  }

  async process(job: Job<{ eventoCrudoId: string }>): Promise<void> {
    const { eventoCrudoId } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `[EventProcessor] Processing event [eventId=${eventoCrudoId}, attempt=${job.attemptsMade + 1}]`,
    );

    const repo = this.dataSource.getRepository(EventoCrudo);

    // 1. Load the evento_crudo from DB
    const event = await repo.findOne({ where: { id: eventoCrudoId } });

    if (!event) {
      this.logger.warn(
        `[EventProcessor] Event not found in DB [eventId=${eventoCrudoId}] — skipping`,
      );
      return;
    }

    // 2. Update status = 'processing'
    await repo.update({ id: eventoCrudoId }, { status: 'processing' });

    try {
      // 3. Execute business logic (placeholder — actual processing in M4+)
      // Future: route to domain handlers based on event.source
      this.logger.log(
        `[EventProcessor] Event processing placeholder executed [eventId=${eventoCrudoId}, source=${event.source}]`,
      );

      // 4. Update status = 'processed'
      const duration = Date.now() - startTime;
      await repo.update(
        { id: eventoCrudoId },
        {
          status: 'processed',
          processed: true,
          processed_at: new Date(),
        },
      );

      this.logger.log(
        `[EventProcessor] Event processed [eventId=${eventoCrudoId}, duration=${duration}ms]`,
      );
    } catch (error) {
      const attempts = job.attemptsMade + 1;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown processing error';

      // 5. On failure: update status = 'error', attempts++, publish admin notification.
      // error_message is returned by the API and rendered in the admin UI, so it stores a
      // safe category string only; the raw cause is preserved in the log below.
      await repo.update(
        { id: eventoCrudoId },
        {
          status: 'error',
          error_message: SAFE_MESSAGES.UNEXPECTED,
          attempts,
        },
      );

      this.logger.error(
        `[EventProcessor] Event failed [eventId=${eventoCrudoId}, error=${errorMessage}, attempt=${attempts}]`,
      );

      await this.eventProducer.publishAdminNotification(
        eventoCrudoId,
        `Processing failed: ${errorMessage}`,
      );

      // Re-throw so BullMQ handles retries
      throw error;
    }
  }
}
