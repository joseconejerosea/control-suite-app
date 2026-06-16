import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsNumber,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsIn(['active', 'paused', 'archived', 'closed'])
  status?: 'active' | 'paused' | 'archived' | 'closed';

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  budget?: number;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}