import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ExcelParseOutput {
  columns: string[];
  rows: Record<string, string>[];
  sheet_name: string;
  warnings: string[];
}

@Injectable()
export class ExcelParserService {
  private readonly logger = new Logger(ExcelParserService.name);
  private readonly MAX_ROWS = 5000;

  /**
   * Parses the first non-empty sheet of an XLSX file.
   * Converts all cell values to strings for downstream validation.
   */
  parse(filePath: string): ExcelParseOutput {
    const warnings: string[] = [];
    const workbook = XLSX.readFile(filePath, { cellDates: true });

    const sheetName = workbook.SheetNames.find((n) => {
      const ws = workbook.Sheets[n];
      return ws && ws['!ref'];
    });

    if (!sheetName) {
      return {
        columns: [],
        rows: [],
        sheet_name: '',
        warnings: ['Workbook has no populated sheets.'],
      };
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: '',
      raw: false,
      blankrows: false,
    });

    if (rawRows.length === 0) {
      return {
        columns: [],
        rows: [],
        sheet_name: sheetName,
        warnings: ['Selected sheet has no data rows.'],
      };
    }

    const limitedRows =
      rawRows.length > this.MAX_ROWS ? rawRows.slice(0, this.MAX_ROWS) : rawRows;
    if (rawRows.length > this.MAX_ROWS) {
      warnings.push(`Sheet truncated at ${this.MAX_ROWS} data rows.`);
    }

    const headerSet = new Set<string>();
    limitedRows.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
    const columns = Array.from(headerSet).map((c) => this.normalizeHeader(c));

    const rows: Record<string, string>[] = limitedRows.map((r) => {
      const out: Record<string, string> = {};
      Object.entries(r).forEach(([k, v]) => {
        const key = this.normalizeHeader(k);
        out[key] = this.stringifyCell(v);
      });
      return out;
    });

    this.logger.log(
      `Excel parsed: sheet="${sheetName}" ${rows.length} rows, ${columns.length} columns`,
    );
    return { columns, rows, sheet_name: sheetName, warnings };
  }

  private normalizeHeader(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\w]/g, '');
  }

  private stringifyCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return String(value).trim();
  }
}
