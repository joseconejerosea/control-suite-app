import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

export interface AuditActionOptions {
  action: string;
  entity: string;
}

export const AuditAction = (options: AuditActionOptions) =>
  SetMetadata(AUDIT_ACTION_KEY, options);
