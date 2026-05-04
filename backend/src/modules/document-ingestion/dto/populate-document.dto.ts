import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class PopulateDocumentDto {
  /**
   * Optional override mapping: { sourceColumn: targetField }
   * If not provided, uses the mapping stored in parse_result.
   */
  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;

  /**
   * If true, continues inserting even when some rows fail validation.
   * Failed rows are recorded in parse_result.errors and rows_failed is incremented.
   * Default: true.
   */
  @IsOptional()
  @IsBoolean()
  continue_on_error?: boolean;
}
