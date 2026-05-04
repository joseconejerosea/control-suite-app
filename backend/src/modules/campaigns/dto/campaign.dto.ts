import {
  IsString,
  IsOptional,
  IsIn,
  IsUUID,
  IsDateString,
  IsNumber,
  IsPositive,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types'; 

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  start_date!: string;

  @IsDateString()
  end_date!: string;

  @IsIn(['draft', 'active', 'paused', 'completed', 'cancelled'])
  @IsOptional()
  status?: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

  @IsNumber()
  @IsPositive()
  @IsOptional()
  budget?: number;

  @IsUUID()
  @IsOptional()
  location_id?: string;
}

export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {} 