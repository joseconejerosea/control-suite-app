import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCollaboratorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  full_name: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsIn(['observer', 'supervisor', 'coordinator', 'brand_manager'])
  role_label?: 'observer' | 'supervisor' | 'coordinator' | 'brand_manager';

  @IsOptional()
  @IsUUID('4')
  project_id?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
