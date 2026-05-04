import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class QueryEventosCrudosDto {
  @IsOptional()
  @IsIn(['received', 'queued', 'processing', 'processed', 'error', 'sin_contexto'])
  status?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
