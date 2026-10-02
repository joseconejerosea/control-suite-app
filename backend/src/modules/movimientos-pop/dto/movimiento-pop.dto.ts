import { IsString, IsOptional, IsUUID, IsInt, IsIn, IsDateString, Min, ValidateIf } from 'class-validator';

export class CreateMovimientoDto {
  @IsUUID() sku_id: string;
  @IsOptional() @IsUUID() persona_id?: string;
  @IsOptional() @IsUUID() bodega_origen_id?: string;
  /** Requerido para tipo salida o consumo; opcional para los demás.
   * El traslado NO lo lleva: es un movimiento bodega↔bodega, sin proyecto. */
  @ValidateIf(o => ['salida', 'consumo'].includes(o.tipo))
  @IsUUID() proyecto_destino_id?: string;
  @IsOptional() @IsUUID() bodega_destino_id?: string;
  @IsOptional() @IsUUID() activacion_id?: string;
  @IsIn(['salida','entrada','devolucion','consumo','merma','transfer','adjustment']) tipo: string;
  @IsInt() @Min(1) cantidad: number;
  @IsOptional() @IsString() foto_key?: string;
  @IsOptional() @IsInt() tiempo_uso_dias?: number;
  @IsOptional() @IsDateString() fecha_retorno_esperada?: string;
  @IsOptional() @IsString() observacion?: string;
  /** F3 · Auditoría: usuario que REGISTRÓ el movimiento (lo setea el controller = user.sub,
   * H5: nunca se confía del body). Separado de persona_id (el field-person para devoluciones). */
  @IsOptional() @IsUUID() created_by_user_id?: string;
}

export class MovimientoFiltersDto {
  @IsOptional() @IsUUID() sku_id?: string;
  @IsOptional() @IsUUID() bodega_origen_id?: string;
  @IsOptional() @IsUUID() proyecto_destino_id?: string;
  @IsOptional() @IsString() tipo?: string;
  @IsOptional() @IsString() estado?: string;
}
