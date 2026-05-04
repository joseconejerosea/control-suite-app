import { Injectable } from '@nestjs/common';
import { TargetTable } from '../document-upload.entity';

export interface ValidationResult {
  valid_rows: Record<string, unknown>[];
  invalid_rows: Array<{ row_index: number; reason: string; original: Record<string, unknown> }>;
}

const REQUIRED_BY_TABLE: Record<TargetTable, string[]> = {
  promoters: ['first_name', 'last_name', 'email'],
  locations: ['name'],
  campaigns: ['name', 'start_date', 'end_date'],
  activations: ['activation_date'],
  collaborators: ['full_name'],
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const DECIMAL_REGEX = /^-?\d+(\.\d+)?$/;

@Injectable()
export class ValidationService {
  /**
   * Applies mapping to each row, then validates against target table requirements.
   * Invalid rows are returned separately so the caller can record them.
   */
  validate(
    rows: Record<string, unknown>[],
    mapping: Record<string, string>,
    targetTable: TargetTable,
  ): ValidationResult {
    const required = REQUIRED_BY_TABLE[targetTable] ?? [];
    const validRows: Record<string, unknown>[] = [];
    const invalidRows: ValidationResult['invalid_rows'] = [];

    // For activations, we need EITHER campaign_id OR campaign_name
    const activationCampaignRule = targetTable === 'activations';

    rows.forEach((sourceRow, index) => {
      const mapped: Record<string, unknown> = {};

      // Apply column mapping
      Object.entries(sourceRow).forEach(([srcKey, value]) => {
        const targetField = mapping[srcKey];
        if (targetField) {
          mapped[targetField] = value;
        }
      });

      // Check required fields
      const missingRequired = required.filter(
        (f) => mapped[f] === undefined || mapped[f] === null || mapped[f] === '',
      );

      if (missingRequired.length > 0) {
        invalidRows.push({
          row_index: index,
          reason: `Missing required fields: ${missingRequired.join(', ')}`,
          original: sourceRow,
        });
        return;
      }

      if (activationCampaignRule) {
        const hasCampaign =
          (mapped.campaign_id && String(mapped.campaign_id).trim() !== '') ||
          (mapped.campaign_name && String(mapped.campaign_name).trim() !== '');
        if (!hasCampaign) {
          invalidRows.push({
            row_index: index,
            reason: 'Activation requires either campaign_id or campaign_name',
            original: sourceRow,
          });
          return;
        }
      }

      // Type-specific validations
      const typeError = this.validateTypes(mapped, targetTable);
      if (typeError) {
        invalidRows.push({ row_index: index, reason: typeError, original: sourceRow });
        return;
      }

      validRows.push(mapped);
    });

    return { valid_rows: validRows, invalid_rows: invalidRows };
  }

  private validateTypes(row: Record<string, unknown>, targetTable: TargetTable): string | null {
    if (row.email && !EMAIL_REGEX.test(String(row.email))) {
      return `Invalid email format: ${String(row.email)}`;
    }

    for (const dateField of ['start_date', 'end_date', 'activation_date', 'birth_date']) {
      if (row[dateField] && !DATE_REGEX.test(String(row[dateField]))) {
        return `Invalid date format for ${dateField}: ${String(row[dateField])} (expected YYYY-MM-DD)`;
      }
    }

    if (targetTable === 'campaigns' && row.start_date && row.end_date) {
      if (String(row.start_date) > String(row.end_date)) {
        return `start_date (${String(row.start_date)}) is after end_date (${String(row.end_date)})`;
      }
    }

    for (const numField of ['budget', 'latitude', 'longitude']) {
      if (row[numField] !== undefined && row[numField] !== null && row[numField] !== '') {
        if (!DECIMAL_REGEX.test(String(row[numField]))) {
          return `Invalid number format for ${numField}: ${String(row[numField])}`;
        }
      }
    }

    return null;
  }
}
