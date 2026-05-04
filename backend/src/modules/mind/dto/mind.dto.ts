import { IsString, IsOptional, IsIn, IsUUID } from 'class-validator';

export class SendMessageDto {
  @IsString() mensaje: string;
  @IsOptional() @IsIn(['proactivo','ejecutor','analista']) perfil?: string;
}

export class AprobarPropuestaDto {
  @IsOptional() @IsString() nota?: string;
}

export class RechazarPropuestaDto {
  @IsOptional() @IsString() motivo?: string;
}

export class EjecutarTareaDto {
  @IsString() instruccion: string;
  @IsOptional() contexto?: Record<string, unknown>;
}
