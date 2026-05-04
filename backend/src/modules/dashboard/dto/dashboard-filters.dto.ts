import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class DashboardFiltersDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID('4')
  project_id?: string;
}
