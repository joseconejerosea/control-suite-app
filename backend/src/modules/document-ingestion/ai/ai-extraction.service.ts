import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { TargetTable } from '../document-upload.entity';

export interface AiExtractionInput {
  text: string;
  target_table: TargetTable;
}

export interface AiExtractionOutput {
  columns: string[];
  rows: Record<string, string>[];
  confidence: number;
  tokens_used: { prompt: number; completion: number };
  warnings: string[];
}

const TARGET_SCHEMAS: Record<TargetTable, { required: string[]; optional: string[] }> = {
  promoters: {
    required: ['first_name', 'last_name', 'email'],
    optional: ['phone', 'rut', 'birth_date', 'gender', 'notes'],
  },
  locations: {
    required: ['name'],
    optional: ['address', 'city', 'region', 'country', 'latitude', 'longitude', 'notes'],
  },
  campaigns: {
    required: ['name', 'start_date', 'end_date'],
    optional: ['description', 'budget', 'status'],
  },
  activations: {
    required: ['campaign_name', 'activation_date'],
    optional: ['location_name', 'promoter_email', 'status', 'notes'],
  },
  collaborators: {
    required: ['full_name'],
    optional: ['email', 'phone', 'role_label'],
  },
};

@Injectable()
export class AiExtractionService {
  private readonly logger = new Logger(AiExtractionService.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly provider: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('AI_API_KEY');
    this.model = this.config.get<string>('AI_MODEL', 'gpt-4o-mini');
    this.maxTokens = this.config.get<number>('AI_MAX_TOKENS', 4096);
    this.provider = this.config.get<string>('AI_PROVIDER', 'openai');
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async extract(input: AiExtractionInput): Promise<AiExtractionOutput> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'AI extraction not configured. Set AI_API_KEY to enable document parsing.',
      );
    }
    if (this.provider !== 'openai') {
      throw new ServiceUnavailableException(
        `AI provider "${this.provider}" not supported yet. Use AI_PROVIDER=openai.`,
      );
    }

    const schema = TARGET_SCHEMAS[input.target_table];
    const prompt = this.buildPrompt(input.text, input.target_table, schema);

    const client = new OpenAI({ apiKey: this.apiKey });

    try {
      const completion = await client.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a structured-data extraction engine. You output ONLY valid JSON matching the requested schema. No prose, no markdown, no apologies.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const content = completion.choices[0]?.message?.content ?? '{}';
      const parsed = this.safeParseJson(content);

      const rows: Record<string, string>[] = Array.isArray(parsed.rows) ? parsed.rows : [];
      const columns: string[] =
        Array.isArray(parsed.columns) && parsed.columns.length
          ? parsed.columns
          : this.deriveColumns(rows);
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
      const warnings: string[] = Array.isArray(parsed.warnings) ? parsed.warnings : [];

      return {
        rows,
        columns,
        confidence,
        warnings,
        tokens_used: {
          prompt: completion.usage?.prompt_tokens ?? 0,
          completion: completion.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown AI error';
      this.logger.error(`AI extraction failed: ${message}`);
      throw new ServiceUnavailableException(`AI extraction failed: ${message}`);
    }
  }

  private buildPrompt(
    text: string,
    targetTable: TargetTable,
    schema: { required: string[]; optional: string[] },
  ): string {
    return [
      `Extract tabular records from the following text for insertion into the "${targetTable}" table.`,
      ``,
      `Required fields: ${schema.required.join(', ')}`,
      `Optional fields: ${schema.optional.join(', ')}`,
      ``,
      `Return JSON with this exact shape:`,
      `{`,
      `  "columns": ["field1", "field2", ...],`,
      `  "rows": [ { "field1": "value", "field2": "value", ... }, ... ],`,
      `  "confidence": 0.0-1.0,`,
      `  "warnings": [ "..." ]`,
      `}`,
      ``,
      `Rules:`,
      `- All values must be strings.`,
      `- Dates in ISO format YYYY-MM-DD when possible.`,
      `- If a required field is missing for a row, still include the row but leave that field as empty string "".`,
      `- Preserve original casing for names and addresses.`,
      `- If the text contains no extractable records, return an empty rows array.`,
      ``,
      `TEXT TO EXTRACT:`,
      `---`,
      text,
      `---`,
    ].join('\n');
  }

  private safeParseJson(raw: string): {
    rows?: Record<string, string>[];
    columns?: string[];
    confidence?: number;
    warnings?: string[];
  } {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      this.logger.warn('AI returned invalid JSON; returning empty extraction');
      return { rows: [], columns: [], confidence: 0, warnings: ['AI returned invalid JSON'] };
    }
  }

  private deriveColumns(rows: Record<string, string>[]): string[] {
    const set = new Set<string>();
    rows.forEach((r) => Object.keys(r).forEach((k) => set.add(k)));
    return Array.from(set);
  }
}
