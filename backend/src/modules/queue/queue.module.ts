import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_ADMIN_NOTIFICATIONS, QUEUE_EVENT_PROCESSING } from './queue.constants';
import { EventProducer } from './producers/event.producer';
import { EventProcessor } from './processors/event.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { OcrProcessor } from './processors/ocr.processor';
import { ClassifyProcessor } from './processors/classify.processor';
import { PersistProcessor } from './processors/persist.processor';
import { MindProactiveProcessor } from './processors/mind-proactive.processor';
import { MetricsModule } from '../metrics/metrics.module';
import { SheetsModule } from '../sheets/sheets.module';
import { MindModule } from '../mind/mind.module';

const QUEUE_OCR            = 'ocr';
const QUEUE_CLASSIFY       = 'classify';
const QUEUE_PERSIST        = 'persist';
export const QUEUE_MIND_PROACTIVE = 'mind-proactive';

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
      { name: QUEUE_MIND_PROACTIVE },   // ← was missing
    ),
    MetricsModule,
    SheetsModule,
    MindModule,                          // ← needed by MindProactiveProcessor
  ],
  providers: [
    EventProducer,
    EventProcessor,
    NotificationProcessor,
    OcrProcessor,
    ClassifyProcessor,
    PersistProcessor,
    MindProactiveProcessor,             // ← was missing
  ],
  exports: [BullModule, EventProducer],
})
export class QueueModule {}

