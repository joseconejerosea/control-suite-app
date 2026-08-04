import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProjectInboxController } from './project-inbox.controller';
import { ProjectInboxService } from './project-inbox.service';
import { BriefTextExtractorService } from './brief-text-extractor.service';
import { PdfParserService } from '../document-ingestion/parsers/pdf-parser.service';
import { ExcelParserService } from '../document-ingestion/parsers/excel-parser.service';
import { CsvParserService } from '../document-ingestion/parsers/csv-parser.service';

const QUEUE_PROJECT_INBOX_EXTRACT = 'project-inbox-extract';
const QUEUE_OCR = 'ocr';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_PROJECT_INBOX_EXTRACT }),
    BullModule.registerQueue({ name: QUEUE_OCR }),
  ],
  controllers: [ProjectInboxController],
  providers: [
    ProjectInboxService,
    BriefTextExtractorService,
    // Los parsers son stateless; se proveen acá para inyectarlos en el extractor.
    PdfParserService,
    ExcelParserService,
    CsvParserService,
  ],
  // El processor (QueueModule) reutiliza el extractor de briefs.
  exports: [ProjectInboxService, BriefTextExtractorService],
})
export class ProjectInboxModule {}
