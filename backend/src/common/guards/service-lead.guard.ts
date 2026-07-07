import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../enums/user-role.enum';
import { ServiceLeadTenant } from '../../modules/auth/entities/service-lead-tenant.entity';

/**
 * ServiceLeadGuard — núcleo de seguridad del rol SERVICE_LEAD (Diseño B).
 *
 * Corre DESPUÉS de AuthGuard (necesita req.user decodificado). Registrado como
 * APP_GUARD global, justo después de AuthGuard y antes de ClientIsolationGuard.
 *
 * Sólo paga costo de DB para el SERVICE_LEAD; cualquier otro rol (o request sin
 * user, p.ej. rutas @Public) pasa de largo.
 *
 * - SL SIN tenant activo (no eligió agencia): sólo se permiten las rutas de
 *   selección (GET /auth/my-tenants, POST /auth/select-tenant). Cualquier otra
 *   ruta → 403 "Seleccioná una agencia primero".
 * - SL CON tenant activo: se valida que exista la asignación (sub, client_id) en
 *   service_lead_tenants; si no → 403 "No estás asignado a esta agencia".
 */
@Injectable()
export class ServiceLeadGuard implements CanActivate {
  // Rutas que un SERVICE_LEAD sin agencia activa puede usar para elegirla.
  // Se comparan por sufijo del path para ser robustos al prefijo global de la app.
  private static readonly SELECTION_ROUTES = [
    '/auth/my-tenants',
    '/auth/select-tenant',
  ];

  constructor(
    @InjectRepository(ServiceLeadTenant)
    private readonly serviceLeadTenantRepo: Repository<ServiceLeadTenant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    // Sin user → ruta pública (AuthGuard ya la resolvió). No es asunto nuestro.
    if (!user) return true;

    // Sólo el SERVICE_LEAD paga la validación; el resto pasa sin tocar DB.
    if (user.role !== UserRole.SERVICE_LEAD) return true;

    const activeTenant = user.client_id;

    if (!activeTenant) {
      // Todavía no eligió agencia: sólo puede llegar a las rutas de selección.
      if (this.isSelectionRoute(req)) return true;
      throw new ForbiddenException('Seleccioná una agencia primero');
    }

    // Tiene tenant activo: debe existir la asignación para ese tenant.
    const assignment = await this.serviceLeadTenantRepo.findOne({
      where: { user_id: user.sub, tenant_id: activeTenant },
    });
    if (!assignment) {
      throw new ForbiddenException('No estás asignado a esta agencia');
    }

    return true;
  }

  /**
   * Detección de ruta de selección. Se usa el path efectivo del request
   * (req.route?.path da el patrón del handler; req.path/originalUrl el path
   * concreto) y se compara por SUFIJO contra la whitelist, para tolerar un
   * eventual prefijo global (setGlobalPrefix) sin acoplarnos a él.
   */
  private isSelectionRoute(req: {
    route?: { path?: string };
    path?: string;
    originalUrl?: string;
    baseUrl?: string;
  }): boolean {
    const routePattern =
      req.route?.path && req.baseUrl !== undefined
        ? `${req.baseUrl}${req.route.path}`
        : req.route?.path;

    const candidates = [
      routePattern,
      req.path,
      // originalUrl puede traer querystring — cortamos en '?'.
      req.originalUrl?.split('?')[0],
    ].filter((p): p is string => typeof p === 'string');

    return candidates.some((candidate) => {
      const normalized = candidate.replace(/\/+$/, '');
      return ServiceLeadGuard.SELECTION_ROUTES.some((route) =>
        normalized.endsWith(route),
      );
    });
  }
}
