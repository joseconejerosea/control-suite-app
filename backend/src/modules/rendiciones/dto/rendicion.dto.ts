import { IsString, IsOptional, IsUUID, IsDecimal, IsIn } from 'class-validator';

export class AddItemDto {
  @IsUUID()
  invoice_id: string;

  @IsDecimal()
  monto: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class AprobarRendicionDto {
  @IsOptional()
  @IsString()
  nota?: string;
}

export class RechazarRendicionDto {
  @IsString()
  motivo: string;
}

export class MarcarPagadaDto {
  @IsOptional()
  @IsString()
  comprobante_pago_key?: string;
}

export class RendicionFiltersDto {
  @IsOptional()
  @IsUUID()
  persona_id?: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsOptional()
  @IsString()
  estado?: string;

  @IsOptional()
  @IsString()
  periodo?: string;
}
