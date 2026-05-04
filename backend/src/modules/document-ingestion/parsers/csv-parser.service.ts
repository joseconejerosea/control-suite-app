import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as readline from 'readline';

export interface CsvParseOutput {
  columns: string[];
  rows: Record<string, string>[];
  delimiter: string;
  warnings: string[];
}

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);
  private readonly MAX_ROWS = 5000;

  /**
   * Parses CSV or TSV files. Auto-detects delimiter.
   * Streams line-by-line to avoid loading large files into memory.
   */
  async parse(filePath: string): Promise<CsvParseOutput> {
    const warnings: string[] = [];
    const rowsRaw: string[] = [];

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of reader) {
      if (line.trim() === '') continue;
      rowsRaw.push(line);
      if (rowsRaw.length >= this.MAX_ROWS + 1) {
        warnings.push(`File truncated at ${this.MAX_ROWS} data rows.`);
        break;
      }
    }

    if (rowsRaw.length === 0) {
      return { columns: [], rows: [], delimiter: ',', warnings: ['File is empty.'] };
    }

    const headerLine = rowsRaw[0];
    const delimiter = this.detectDelimiter(headerLine);
    const columns = this.splitLine(headerLine, delimiter).map((c) => this.normalizeHeader(c));

    const rows: Record<string, string>[] = [];
    for (let i = 1; i < rowsRaw.length; i++) {
      const parts = this.splitLine(rowsRaw[i], delimiter);
      if (parts.length !== columns.length) {
        warnings.push(`Row ${i}: column count mismatch (${parts.length} vs ${columns.length}).`);
      }
      const row: Record<string, string> = {};
      for (let c = 0; c < columns.length; c++) {
        row[columns[c]] = (parts[c] ?? '').trim();
      }
      rows.push(row);
    }

    this.logger.log(`CSV parsed: ${rows.length} rows, ${columns.length} columns`);
    return { columns, rows, delimiter, warnings };
  }

  private detectDelimiter(headerLine: string): string {
    const commaCount = (headerLine.match(/,/g) ?? []).length;
    const tabCount = (headerLine.match(/\t/g) ?? []).length;
    const semiCount = (headerLine.match(/;/g) ?? []).length;
    const max = Math.max(commaCount, tabCount, semiCount);
    if (max === 0) return ',';
    if (tabCount === max) return '\t';
    if (semiCount === max) return ';';
    return ',';
  }

  /**
   * Basic CSV line splitter with quote handling.
   * Handles "quoted, values" and escaped quotes ("").
   */
  private splitLine(line: string, delimiter: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current);
    return out;
  }

  private normalizeHeader(raw: string): string {
    return raw
      .trim()
      .replace(/^"|"$/g, '')
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\w]/g, '');
  }
}
