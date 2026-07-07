import { UserRole } from '../enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  client_id: string;
  clientId?: string; // backward compat
  email: string;
  role: UserRole;
  // Diseño B — presente sólo cuando un SERVICE_LEAD ya eligió agencia. Marca
  // explícitamente que client_id proviene de una selección de tenant, no del
  // tenant fijo del usuario. ServiceLeadGuard valida la asignación en cada req.
  activeTenantId?: string;
  iat?: number;
  exp?: number;
}