import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buffer: Buffer) => Promise<{ text: string; numpages: number }> = require('pdf-parse');

export interface PdfParseOutput {
  text: string;
  num_pages: number;
  warnings: string[];
}

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);
  private readonly MAX_CHARS = 100_000;

  /**
   * Extracts raw text from a PDF file.
   * The extracted text must be passed to AiExtractionService
   * for structured row extraction — PDFs never contain tabular data directly.
   */
  async parse(filePath: string): Promise<PdfParseOutput> {
    const warnings: string[] = [];
    const buffer = await fs.readFile(filePath);
    const result = await pdfParse(buffer);

    let text = (result.text ?? '').trim();
    if (text.length > this.MAX_CHARS) {
      warnings.push(
        `PDF text truncated at ${this.MAX_CHARS} characters (was ${text.length}).`,
      );
      text = text.slice(0, this.MAX_CHARS);
    }

    if (text.length === 0) {
      warnings.push('PDF contains no extractable text (may be scanned images).');
    }

    this.logger.log(`PDF parsed: ${result.numpages} pages, ${text.length} chars`);
    return { text, num_pages: result.numpages, warnings };
  }
}
