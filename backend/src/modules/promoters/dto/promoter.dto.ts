import {
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  MaxLength,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { PROMOTOR_ROL_TIPO_MEMBERS } from '../../../common/promoter-role/role-rota.util';

export class CreatePromoterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  first_name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  last_name!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(/^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/, {
    message: 'rut must be in format XX.XXX.XXX-X',
  })
  rut?: string;

  @IsIn(['active', 'inactive', 'suspended'])
  @IsOptional()
  status?: 'active' | 'inactive' | 'suspended';

  @IsString()
  @IsOptional()
  @MaxLength(100)
  rol?: string;

  // Rol estructurado. Validado contra el enum; el servidor deriva `rota` de este campo.
  // `rota` NO es parte del DTO — el cliente no puede establecerlo (spec I-6).
  @IsOptional()
  @IsIn([...PROMOTOR_ROL_TIPO_MEMBERS])
  rol_tipo?: string;
}

export class UpdatePromoterDto extends PartialType(CreatePromoterDto) {}
