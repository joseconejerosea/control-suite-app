import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import {
  DocumentUpload,
  ParseResult,
  ParseResultRow,
  TargetTable,
} from './document-upload.entity';
import { CsvParserService } from './parsers/csv-parser.service';
import { ExcelParserService } from './parsers/excel-parser.service';
import { PdfParserService } from './parsers/pdf-parser.service';
import { AiExtractionService } from './ai/ai-extraction.service';
import { ColumnMapperService } from './ai/column-mapper.service';
import { ValidationService } from './populators/validation.service';
import { DbPopulatorService } from './populators/db-populator.service';
import { PopulateDocumentDto } from './dto/populate-document.dto';

export interface UploadMeta {
  originalName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  targetTable: TargetTable;
  projectId?: string | null;
  uploadedBy: string;
}

@Injectable()
export class DocumentIngestionService {
  private readonly logger = new Logger(DocumentIngestionService.name);
  private readonly repo: TenantRepository<DocumentUpload>;
  private readonly uploadDir: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly csvParser: CsvParserService,
    private readonly excelParser: ExcelParserService,
    private readonly pdfParser: PdfParserService,
    private readonly aiExtractor: AiExtractionService,
    private readonly columnMapper: ColumnMapperService,
    private readonly validator: ValidationService,
    private readonly populator: DbPopulatorService,
  ) {
    this.repo = new TenantRepository<DocumentUpload>(dataSource, DocumentUpload);
    this.uploadDir = this.config.get<string>('UPLOAD_DIR', './uploads');
  }

  async registerUpload(clientId: string, meta: UploadMeta): Promise<DocumentUpload> {
    return this.repo.create(clientId, {
      uploaded_by: meta.uploadedBy,
      project_id: meta.projectId ?? null,
      original_name: meta.originalName,
      mime_type: meta.mimeType,
      file_size: meta.fileSize,
      storage_path: meta.storagePath,
      target_table: meta.targetTable,
      status: 'uploaded',
      rows_inserted: 0,
      rows_failed: 0,
    });
  }

  async findAll(
    clientId: string,
    filters: { status?: string; project_id?: string } = {},
  ): Promise<DocumentUpload[]> {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.project_id) where.project_id = filters.project_id;
    return this.repo.findAll(clientId, {
      where: where as any,
      order: { created_at: 'DESC' },
    });
  }

  async findOne(clientId: string, id: string): Promise<DocumentUpload> {
    return this.repo.findOne(clientId, id);
  }

  async parse(clientId: string, id: string): Promise<DocumentUpload> {
    const doc = await this.findOne(clientId, id);

    if (!doc.target_table) {
      throw new BadRequestException('Document has no target_table set.');
    }
    if (doc.status === 'processing') {
      throw new BadRequestException('Document is already being processed.');
    }
    await this.repo.update(clientId, id, {
      status: 'processing',
      error_detail: null,
    });

    try {
      const absolutePath = path.resolve(this.uploadDir, doc.storage_path);
      await fs.access(absolutePath);

      let columns: string[] = [];
      let rows: Record<string, string>[] = [];
      const warnings: string[] = [];
      let tokensUsed: { prompt: number; completion: number } | undefined;

      if (doc.mime_type === 'application/pdf') {
        const pdfOut = await this.pdfParser.parse(absolutePath);
        warnings.push(...pdfOut.warnings);

        if (!this.aiExtractor.isConfigured()) {
          throw new Error(
            'AI_API_KEY not configured. PDF parsing requires AI extraction.',
          );
        }
        const aiOut = await this.aiExtractor.extract({
          text: pdfOut.text,
          target_table: doc.target_table,
        });
        columns = aiOut.columns;
        rows = aiOut.rows;
        warnings.push(...aiOut.warnings);
        tokensUsed = aiOut.tokens_used;
      } else if (
        doc.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        doc.mime_type === 'application/vnd.ms-excel' ||
        doc.original_name.toLowerCase().endsWith('.xlsx') ||
        doc.original_name.toLowerCase().endsWith('.xls')
      ) {
        const xOut = this.excelParser.parse(absolutePath);
        columns = xOut.columns;
        rows = xOut.rows;
        warnings.push(...xOut.warnings);
      } else {
        const cOut = await this.csvParser.parse(absolutePath);
        columns = cOut.columns;
        rows = cOut.rows;
        warnings.push(...cOut.warnings);
      }

      const mappingResult = this.columnMapper.map(columns, doc.target_table);
      if (mappingResult.missing_required.length > 0) {
        warnings.push(
          `Missing required mappings: ${mappingResult.missing_required.join(', ')}`,
        );
      }

      const parseResult: ParseResult = {
        columns,
        rows: rows as ParseResultRow[],
        mapping: mappingResult.mapping,
        confidence: mappingResult.confidence,
        warnings,
        ...(tokensUsed ? { tokens_used: tokensUsed } : {}),
      };

      return this.repo.update(clientId, id, {
        parse_result: parseResult,
        status: 'parsed',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown parse error';
      this.logger.error(`Parse failed for document ${id}: ${message}`);
      await this.repo.update(clientId, id, {
        status: 'error',
        error_detail: message,
      });
      throw new InternalServerErrorException(`Parse failed: ${message}`);
    }
  }

  async preview(clientId: string, id: string) {
    const doc = await this.findOne(clientId, id);
    if (!doc.parse_result) {
      throw new BadRequestException('Document has not been parsed yet.');
    }

    const sampleSize = 10;
    return {
      document_id: doc.id,
      status: doc.status,
      target_table: doc.target_table,
      columns: doc.parse_result.columns,
      mapping: doc.parse_result.mapping,
      confidence: doc.parse_result.confidence,
      warnings: doc.parse_result.warnings,
      total_rows: doc.parse_result.rows.length,
      sample_rows: doc.parse_result.rows.slice(0, sampleSize),
    };
  }

  async populate(
    clientId: string,
    id: string,
    dto: PopulateDocumentDto,
  ): Promise<DocumentUpload> {
    const doc = await this.findOne(clientId, id);
    if (doc.status !== 'parsed') {
      throw new BadRequestException(
        `Document must be in 'parsed' status (current: ${doc.status}).`,
      );
    }
    if (!doc.parse_result || !doc.target_table) {
      throw new BadRequestException('Document has no parsed result.');
    }

    const mapping = dto.mapping ?? doc.parse_result.mapping;
    const continueOnError = dto.continue_on_error ?? true;

    const validation = this.validator.validate(
      doc.parse_result.rows as Record<string, unknown>[],
      mapping,
      doc.target_table,
    );

    const result = await this.populator.populate(
      clientId,
      doc.target_table,
      validation.valid_rows,
      doc.project_id,
      continueOnError,
    );

    const combinedErrors: ParseResult['errors'] = [
      ...validation.invalid_rows.map((r) => ({
        row_index: r.row_index,
        reason: r.reason,
      })),
      ...result.errors,
    ];

    return this.repo.update(clientId, id, {
      status: 'populated',
      rows_inserted: result.inserted,
      rows_failed: validation.invalid_rows.length + result.failed,
      parse_result: { ...doc.parse_result, errors: combinedErrors },
    });
  }

  async reprocess(clientId: string, id: string): Promise<DocumentUpload> {
    const doc = await this.findOne(clientId, id);
    if (doc.status !== 'error') {
      throw new BadRequestException(
        `Only documents in 'error' status can be reprocessed (current: ${doc.status}).`,
      );
    }

    await this.repo.update(clientId, id, {
      status: 'uploaded',
      error_detail: null,
      parse_result: null,
    });
    return this.parse(clientId, id);
  }
}