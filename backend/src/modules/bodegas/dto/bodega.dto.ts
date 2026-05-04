// ─── DTOs ────────────────────────────────────────────────────────────────────
import { IsString, IsOptional, IsUUID, IsBoolean, IsIn } from 'class-validator';

export class CreateBodegaDto {
  @IsString() nombre: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsUUID() encargado_persona_id?: string;
  @IsOptional() @IsIn(['principal','sub_bodega','aeropuerto','regional']) tipo?: string;
}

export class UpdateBodegaDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsUUID() encargado_persona_id?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
