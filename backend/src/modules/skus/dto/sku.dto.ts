import { IsString, IsOptional, IsDecimal, IsIn, IsDateString, IsInt, Min } from 'class-validator';

export class CreateSkuDto {
  @IsString() codigo: string;
  @IsString() nombre: string;
  @IsOptional() @IsString() cliente_final?: string;
  @IsOptional() @IsString() dimensiones?: string;
  @IsOptional() @IsDecimal() peso_kg?: string;
  @IsOptional() @IsDecimal() valor_unitario?: string;
  @IsOptional() @IsString() proveedor_fabricacion?: string;
  @IsOptional() @IsDateString() fabricado_at?: string;
  @IsOptional() @IsIn(['reusable','consumible']) tipo?: string;
  @IsOptional() @IsInt() @Min(0) min_stock?: number;
}

export class UpdateSkuDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() cliente_final?: string;
  @IsOptional() @IsDecimal() valor_unitario?: string;
  @IsOptional() @IsIn(['reusable','consumible']) tipo?: string;
  @IsOptional() @IsInt() @Min(0) min_stock?: number;
}
