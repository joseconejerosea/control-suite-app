import { IsIn, IsOptional } from 'class-validator';

/**
 * Query params for GET /pending-staff.
 *
 * estado is optional. When provided it must be one of the three valid lifecycle
 * values — any other string is rejected with a 400 by the global ValidationPipe.
 */
export class ListPendingStaffQueryDto {
  @IsOptional()
  @IsIn(['pendiente', 'agregado', 'descartado'])
  estado?: 'pendiente' | 'agregado' | 'descartado';
}
