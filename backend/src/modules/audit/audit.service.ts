import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditLogFiltersDto } from './dto/audit-log-filters.dto';
import { getTenantStore, runAsSystem, tenantManager } from '../../common/tenant/tenant-context';

export interface AuditLogInput {
  tenantId?: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  async log(input: AuditLogInput): Promise<void> {
    const write = () =>
      tenantManager(this.ds).getRepository(AuditLog).insert({
        tenant_id: input.tenantId ?? null,
        user_id: input.userId,
        action: input.action,
        entity: input.entity,
        entity_id: input.entityId,
        metadata: input.metadata ?? null,
        ip: input.ip ?? null,
      });
    try {
      // Si la request ya abrió contexto de tenant, escribe ahí; si no (login,
      // acciones de sistema), por el pool de sistema para no chocar con RLS.
      const store = getTenantStore();
      if (store) {
        // El audit corre en la MISMA transacción del request. Sin aislarlo, un
        // INSERT que falla (p.ej. una columna inválida) aborta toda la tx y
        // descarta la operación real en silencio. El SAVEPOINT acota el fallo:
        // sólo se revierte el audit, la operación del caller sobrevive y commitea.
        const qr = store.queryRunner;
        await qr.query('SAVEPOINT audit_log');
        try {
          await write();
          await qr.query('RELEASE SAVEPOINT audit_log');
        } catch (err) {
          await qr.query('ROLLBACK TO SAVEPOINT audit_log').catch(() => {});
          throw err;
        }
      } else {
        await runAsSystem(write);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Failed to write audit log: ${msg}`);
    }
  }

  async findAll(filters: AuditLogFiltersDto, tenantId?: string) {
    const qb = tenantManager(this.ds).getRepository(AuditLog).createQueryBuilder('al')
      .orderBy('al.created_at', 'DESC');

    if (tenantId) {
      qb.andWhere('al.tenant_id = :tenantId', { tenantId });
    }

    if (filters.tenant_id) {
      qb.andWhere('al.tenant_id = :filtTenant', { filtTenant: filters.tenant_id });
    }

    if (filters.user_id) {
      qb.andWhere('al.user_id = :userId', { userId: filters.user_id });
    }

    if (filters.action) {
      qb.andWhere('al.action = :action', { action: filters.action });
    }

    if (filters.entity) {
      qb.andWhere('al.entity = :entity', { entity: filters.entity });
    }

    if (filters.entity_id) {
      qb.andWhere('al.entity_id = :entityId', { entityId: filters.entity_id });
    }

    if (filters.from) {
      qb.andWhere('al.created_at >= :from', { from: filters.from });
    }

    if (filters.to) {
      qb.andWhere('al.created_at <= :to', { to: filters.to });
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
