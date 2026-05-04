import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCanalEntradaDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsIn(['whatsapp', 'email', 'generic'])
  tipo: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateCanalEntradaDto extends PartialType(CreateCanalEntradaDto) {}
