import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_ADMIN_NOTIFICATIONS, QUEUE_EVENT_PROCESSING } from './queue.constants';
import { EventProducer } from './producers/event.producer';
import { EventProcessor } from './processors/event.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { OcrProcessor } from './processors/ocr.processor';
import { ClassifyProcessor } from './processors/classify.processor';
import { PersistProcessor } from './processors/persist.processor';
import { MetricsModule } from '../metrics/metrics.module';
import { SheetsModule } from '../sheets/sheets.module';

const QUEUE_OCR      = 'ocr';
const QUEUE_CLASSIFY = 'classify';
const QUEUE_PERSIST  = 'persist';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT ?? '6379'),
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_EVENT_PROCESSING },
      { name: QUEUE_ADMIN_NOTIFICATIONS },
      { name: QUEUE_OCR },
      { name: QUEUE_CLASSIFY },
      { name: QUEUE_PERSIST },
    ),
    MetricsModule,
    SheetsModule,
  ],
  providers: [
    EventProducer,
    EventProcessor,
    NotificationProcessor,
    OcrProcessor,
    ClassifyProcessor,
    PersistProcessor,
  ],
  exports: [BullModule, EventProducer],
})
export class QueueModule {}

