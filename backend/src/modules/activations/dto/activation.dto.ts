import {
  IsUUID,
  IsDateString,
  IsOptional,
  IsIn,
  IsString,
  MaxLength,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types'; 

export class CreateActivationDto {
  @IsUUID()
  @IsNotEmpty()
  campaign_id!: string;

  @IsUUID()
  @IsOptional()
  promoter_id?: string;

  @IsUUID()
  @IsOptional()
  location_id?: string;

  @IsDateString()
  activation_date!: string;

  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'start_time must be HH:MM format',
  })
  start_time?: string;

  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'end_time must be HH:MM format',
  })
  end_time?: string;

  @IsIn(['scheduled', 'in_progress', 'completed', 'cancelled'])
  @IsOptional()
  status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}


// PartialType automatically makes all CreateActivationDto fields optional
export class UpdateActivationDto extends PartialType(CreateActivationDto) {}