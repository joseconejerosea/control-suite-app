export interface JwtPayload {
  sub: string;
  client_id: string;
  clientId?: string; // backward compat
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}