import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

/**
 * Extracts the authenticated tenant id from the request.
 *
 * The tenant id is set on `request.user` by the global AuthGuard, which
 * normalises it to `client_id` (single source of truth). This helper FAILS
 * CLOSED: if there is no tenant context it throws instead of returning
 * `undefined` — a `undefined` tenant id silently drops `WHERE client_id`
 * filters and leaks across tenants.
 *
 * Use this on every tenant-scoped route. Do NOT use it on `super_admin`
 * cross-tenant routes (those have no single tenant context by design).
 */
export function extractClientId(ctx: ExecutionContext): string {
  const request = ctx.switchToHttp().getRequest();
  const clientId: string | undefined = request.user?.client_id;
  if (!clientId) {
    throw new ForbiddenException('No tenant context');
  }
  return clientId;
}

export const CurrentClientId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => extractClientId(ctx),
);
