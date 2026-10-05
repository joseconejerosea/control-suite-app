import { IsEmail, IsString, MinLength, IsOptional, IsUUID } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /**
   * Desambiguación multi-tenant: cuando el mismo email + contraseña existe en
   * más de una agencia, el primer login responde { needsTenant, tenants } y el
   * frontend reenvía el POST con la agencia elegida en `tenantId`.
   */
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}