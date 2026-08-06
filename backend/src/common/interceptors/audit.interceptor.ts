import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';
import {
  AUDIT_ACTION_KEY,
  AuditActionOptions,
} from '../decorators/audit-action.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMeta = this.reflector.get<AuditActionOptions | undefined>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.sub) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((responseBody) => {
        const entityId =
          request.params?.id ??
          (responseBody as Record<string, unknown>)?.id ??
          'unknown';

        this.auditService.log({
          tenantId: user.client_id ?? user.clientId,
          userId: user.sub,
          action: auditMeta.action,
          entity: auditMeta.entity,
          entityId: String(entityId),
          metadata: {
            method: request.method,
            path: request.url,
            body: request.method !== 'GET' ? this.sanitizeBody(request.body) : undefined,
          },
          ip: request.ip ?? request.headers['x-forwarded-for'] ?? null,
        });
      }),
    );
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
    if (!body) return {};
    const sanitized = { ...body };
    const sensitiveKeys = ['password', 'token', 'secret', 'api_key', 'apiKey'];
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }
}
