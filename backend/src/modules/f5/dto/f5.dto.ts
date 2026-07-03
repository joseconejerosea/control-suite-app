import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * DTOs validados para F5 (activaciones en terreno).
 *
 * Regla de seguridad (H5): NUNCA se acepta `persona_id` desde el body — la
 * persona es SIEMPRE el usuario autenticado (`user.sub`). Aceptarlo del body
 * permitía impersonar checkins/incidencias de otro promotor.
 */

export class CreateCheckinDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  observacion?: string;
}

export class CreateIncidenciaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  descripcion!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  categoria?: string;

  @IsIn(['baja', 'media', 'alta'])
  @IsOptional()
  severidad?: 'baja' | 'media' | 'alta';
}

export class CreateReporteAvanceDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  momento?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  observacion?: string;
}

/**
 * F5 Fase 2 (GATE): aprobar liga la validación humana al contenido EXACTO que se
 * revisó. Ese htmlReporte queda guardado y es lo único que /enviar puede mandar
 * — el envío ya no acepta contenido del request.
 */
export class AprobarReporteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500_000)
  htmlReporte!: string;
}

export class EnviarReporteDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  destinatarios!: string[];
}

export class CerrarActivacionDto {
  @IsObject()
  @IsOptional()
  cierre?: Record<string, unknown>;
}
