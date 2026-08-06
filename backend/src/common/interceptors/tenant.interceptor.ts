import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Observable, from, firstValueFrom } from 'rxjs';

import { runWithTenant } from '../tenant/tenant-context';

/**
 * Fase 2 · E4a — abre, por cada request HTTP autenticada, una transacción con
 * `app.current_tenant = req.user.client_id` (vía runWithTenant). Combinado con
 * el monkey-patch del DataSource (installTenantQueryRouting), hace que todas las
 * queries de la request corran bajo RLS del tenant correcto.
 *
 * Corre DESPUÉS del AuthGuard (los guards anteceden a los interceptors), así
 * `req.user` ya está poblado. Debe registrarse como el APP_INTERCEPTOR más
 * externo para envolver también al AuditInterceptor (que escribe audit_logs,
 * tabla con RLS).
 *
 * Rutas SIN tenant (login/register, webhooks, health, @Public): no hay
 * client_id → corren sin contexto. El login funciona porque `users` queda fuera
 * de RLS; los webhooks setean su propio contexto en el service (E4c).
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly ds: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest();
    const clientId = req?.user?.client_id;
    if (!clientId) {
      return next.handle();
    }
    return from(runWithTenant(this.ds, clientId, () => firstValueFrom(next.handle())));
  }
}
