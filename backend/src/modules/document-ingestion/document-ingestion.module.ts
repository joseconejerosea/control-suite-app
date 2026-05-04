import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentUpload } from './document-upload.entity';
import { DocumentIngestionController } from './document-ingestion.controller';
import { DocumentIngestionService } from './document-ingestion.service';
import { CsvParserService } from './parsers/csv-parser.service';
import { ExcelParserService } from './parsers/excel-parser.service';
import { PdfParserService } from './parsers/pdf-parser.service';
import { AiExtractionService } from './ai/ai-extraction.service';
import { ColumnMapperService } from './ai/column-mapper.service';
import { ValidationService } from './populators/validation.service';
import { DbPopulatorService } from './populators/db-populator.service';
import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    ClientsModule,
  ],
  controllers: [DocumentIngestionController],
  providers: [
    DocumentIngestionService,
    CsvParserService,
    ExcelParserService,
    PdfParserService,
    AiExtractionService,
    ColumnMapperService,
    ValidationService,
    DbPopulatorService,
  ],
  exports: [DocumentIngestionService],
})
export class DocumentIngestionModule {}