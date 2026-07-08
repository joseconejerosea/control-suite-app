import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export type DashboardPeriod = 'day' | 'week' | 'month' | 'year';

export class DashboardFiltersDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Período semántico que envía el front (Hoy/Semana/Mes/Año). Se traduce a un
  // rango from/to en resolvePeriod. `from`/`to` explícitos tienen prioridad.
  @IsOptional()
  @IsIn(['day', 'week', 'month', 'year'])
  period?: DashboardPeriod;

  @IsOptional()
  @IsUUID('4')
  project_id?: string;
}
