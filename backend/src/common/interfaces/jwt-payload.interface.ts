import { UserRole } from '../enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  client_id: string;
  clientId?: string; // backward compat
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}