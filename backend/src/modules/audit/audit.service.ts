import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditLogFiltersDto } from './dto/audit-log-filters.dto';

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
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.repo.insert({
        tenant_id: input.tenantId ?? null,
        user_id: input.userId,
        action: input.action,
        entity: input.entity,
        entity_id: input.entityId,
        metadata: input.metadata ?? null,
        ip: input.ip ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Failed to write audit log: ${msg}`);
    }
  }

  async findAll(filters: AuditLogFiltersDto, tenantId?: string) {
    const qb = this.repo.createQueryBuilder('al')
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
