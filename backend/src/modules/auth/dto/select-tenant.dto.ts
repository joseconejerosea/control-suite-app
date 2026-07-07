import { IsUUID } from 'class-validator';

export class SelectTenantDto {
  @IsUUID()
  tenantId: string;
}
