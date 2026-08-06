import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PdfParserService } from '../document-ingestion/parsers/pdf-parser.service';
import { ExcelParserService } from '../document-ingestion/parsers/excel-parser.service';
import { CsvParserService } from '../document-ingestion/parsers/csv-parser.service';

// officeparser v7.5.1: parseOffice(buffer, config?) => Promise<AST>, y AST.toText() da texto plano.
// (El brief mencionaba parseOfficeAsync, pero esa API no existe en la versión instalada.)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseOffice } = require('officeparser') as {
  parseOffice: (file: Buffer, config?: unknown) => Promise<{ toText: () => string }>;
};

const MAX_TEXT_CHARS = 45_000;

/**
 * F4 · extracción de texto de briefs subidos a project-inbox.
 *
 * Rutea por MIME (con la extensión como señal de respaldo) al parser correcto y
 * devuelve texto plano listo para la extracción IA. Reutiliza los parsers de
 * document-ingestion (PDF/Excel/CSV) y usa officeparser para DOCX/PPTX.
 *
 * Nunca lanza por un resultado vacío o un formato desconocido: devuelve texto
 * vacío + un warning y deja que el processor decida qué hacer.
 */
@Injectable()
export class BriefTextExtractorService {
  private readonly logger = new Logger(BriefTextExtractorService.name);

  constructor(
    private readonly pdf: PdfParserService,
    private readonly excel: ExcelParserService,
    private readonly csv: CsvParserService,
  ) {}

  async extract(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<{ text: string; warnings: string[] }> {
    const warnings: string[] = [];
    const mime = (mimeType ?? '').toLowerCase();
    const ext = path.extname(filename ?? '').toLowerCase().replace(/^\./, '');

    let text = '';
    try {
      if (this.isPdf(mime, ext)) {
        text = await this.extractPdf(buffer);
      } else if (this.isExcel(mime, ext)) {
        text = await this.extractExcel(buffer, ext);
      } else if (this.isCsv(mime, ext)) {
        text = await this.extractCsv(buffer);
      } else if (this.isOffice(mime, ext)) {
        text = await this.extractWithOfficeparser(buffer);
      } else {
        // Último intento: officeparser soporta varios formatos; si falla, es no soportado.
        try {
          text = await this.extractWithOfficeparser(buffer);
        } catch {
          warnings.push(`formato no soportado: ${mimeType || ext || 'desconocido'}`);
          return { text: '', warnings };
        }
      }
    } catch (err: any) {
      this.logger.warn(`[BriefExtractor] Error extrayendo ${filename}: ${err.message}`);
      warnings.push(`error al extraer texto de ${filename}: ${err.message}`);
      return { text: '', warnings };
    }

    text = (text ?? '').trim();

    if (text.length > MAX_TEXT_CHARS) {
      warnings.push(`texto truncado a ${MAX_TEXT_CHARS} caracteres (era ${text.length}).`);
      text = text.slice(0, MAX_TEXT_CHARS);
    }
    if (text.length === 0) {
      warnings.push(`no se extrajo texto de ${filename} (puede ser un archivo escaneado o vacío).`);
    }

    return { text, warnings };
  }

  private isPdf(mime: string, ext: string): boolean {
    return mime === 'application/pdf' || ext === 'pdf';
  }

  private isExcel(mime: string, ext: string): boolean {
    return (
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/vnd.ms-excel' ||
      ext === 'xlsx' ||
      ext === 'xls'
    );
  }

  private isCsv(mime: string, ext: string): boolean {
    return mime === 'text/csv' || ext === 'csv';
  }

  private isOffice(mime: string, ext: string): boolean {
    return (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword' ||
      mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mime === 'application/vnd.ms-powerpoint' ||
      ['docx', 'doc', 'pptx', 'ppt'].includes(ext)
    );
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    return this.withTempFile(buffer, '.pdf', async (p) => {
      const out = await this.pdf.parse(p);
      return out.text ?? '';
    });
  }

  private async extractExcel(buffer: Buffer, ext: string): Promise<string> {
    return this.withTempFile(buffer, ext === 'xls' ? '.xls' : '.xlsx', async (p) => {
      const out = this.excel.parse(p);
      return this.flatten(out.columns, out.rows);
    });
  }

  private async extractCsv(buffer: Buffer): Promise<string> {
    return this.withTempFile(buffer, '.csv', async (p) => {
      const out = await this.csv.parse(p);
      return this.flatten(out.columns, out.rows);
    });
  }

  private async extractWithOfficeparser(buffer: Buffer): Promise<string> {
    const ast = await parseOffice(buffer);
    return ast?.toText?.() ?? '';
  }

  /** columns en una línea + cada fila con sus valores unidos por ' | ', una línea por fila. */
  private flatten(columns: string[], rows: Record<string, string>[]): string {
    const header = (columns ?? []).join(' | ');
    const body = (rows ?? [])
      .map((r) => Object.values(r).join(' | '))
      .join('\n');
    return [header, body].filter(Boolean).join('\n');
  }

  /** Escribe el buffer a un archivo temporal (los parsers reciben rutas) y limpia al terminar. */
  private async withTempFile<T>(
    buffer: Buffer,
    ext: string,
    fn: (filePath: string) => Promise<T>,
  ): Promise<T> {
    const filePath = path.join(os.tmpdir(), `brief-${randomUUID()}${ext}`);
    await fs.writeFile(filePath, buffer);
    try {
      return await fn(filePath);
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  }
}
