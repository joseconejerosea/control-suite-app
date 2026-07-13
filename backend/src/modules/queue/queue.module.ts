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
import { ReportProcessor } from './processors/report.processor';
import {
  ConvocatoriaClassifyProcessor,
  QUEUE_CONVOCATORIA_CLASSIFY,
} from './processors/convocatoria-classify.processor';
import {
  ProjectInboxExtractProcessor,
  QUEUE_PROJECT_INBOX_EXTRACT,
} from './processors/project-inbox-extract.processor';
import {
  StockReturnPhotoProcessor,
  QUEUE_STOCK_RETURN_PHOTO,
} from './processors/stock-return-photo.processor';
import { MetricsModule } from '../metrics/metrics.module';
import { SheetsModule } from '../sheets/sheets.module';
import { MindModule } from '../mind/mind.module';
import { RendicionesModule } from '../rendiciones/rendiciones.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ProjectsModule } from '../projects/projects.module';
import { MovimientosPopModule } from '../movimientos-pop/movimientos-pop.module';

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
      { name: QUEUE_MIND_PROACTIVE },
      { name: QUEUE_CONVOCATORIA_CLASSIFY },
      { name: QUEUE_PROJECT_INBOX_EXTRACT },
      { name: QUEUE_STOCK_RETURN_PHOTO },
      { name: 'report-gen' },
    ),
    MetricsModule,
    SheetsModule,
    MindModule,
    RendicionesModule,
    WhatsAppModule,
    ProjectsModule,
    MovimientosPopModule,
  ],
  providers: [
    EventProducer,
    EventProcessor,
    NotificationProcessor,
    OcrProcessor,
    ClassifyProcessor,
    PersistProcessor,
    MindProactiveProcessor,
    ReportProcessor,
    ConvocatoriaClassifyProcessor,
    ProjectInboxExtractProcessor,
    StockReturnPhotoProcessor,
  ],
  exports: [BullModule, EventProducer],
})
export class QueueModule {}

