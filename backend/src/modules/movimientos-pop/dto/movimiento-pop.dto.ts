import { IsString, IsOptional, IsUUID, IsInt, IsIn, IsDateString, Min } from 'class-validator';

export class CreateMovimientoDto {
  @IsUUID() sku_id: string;
  @IsOptional() @IsUUID() persona_id?: string;
  @IsOptional() @IsUUID() bodega_origen_id?: string;
  @IsOptional() @IsUUID() proyecto_destino_id?: string;
  @IsOptional() @IsUUID() bodega_destino_id?: string;
  @IsIn(['salida','entrada','devolucion','consumo','merma','transfer','adjustment']) tipo: string;
  @IsInt() @Min(1) cantidad: number;
  @IsOptional() @IsString() foto_key?: string;
  @IsOptional() @IsInt() tiempo_uso_dias?: number;
  @IsOptional() @IsDateString() fecha_retorno_esperada?: string;
  @IsOptional() @IsString() observacion?: string;
}

export class MovimientoFiltersDto {
  @IsOptional() @IsUUID() sku_id?: string;
  @IsOptional() @IsUUID() bodega_origen_id?: string;
  @IsOptional() @IsUUID() proyecto_destino_id?: string;
  @IsOptional() @IsString() tipo?: string;
  @IsOptional() @IsString() estado?: string;
}
