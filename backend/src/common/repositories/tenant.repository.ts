import { Repository, DataSource, EntityTarget, FindManyOptions, FindOptionsWhere } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { TenantBaseEntity } from '../entities/tenant-base.entity';
import { getTenantStore } from '../tenant/tenant-context';

export class TenantRepository<T extends TenantBaseEntity> {
  private readonly repo: Repository<T>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly entity: EntityTarget<T>,
  ) {
    this.repo = dataSource.getRepository(entity);
  }

  /**
   * Fase 2 — repo ligado a la unidad de trabajo actual. Dentro de un contexto de
   * tenant (runWithTenant/runAsSystem), usa el manager del QueryRunner con el GUC
   * seteado → las queries del ORM corren bajo RLS del tenant. Fuera de contexto,
   * el repo normal del DataSource. (Los métodos siguen filtrando por client_id:
   * defensa en profundidad.)
   */
  private get activeRepo(): Repository<T> {
    const store = getTenantStore();
    return store ? store.queryRunner.manager.getRepository(this.entity) : this.repo;
  }

  findAll(clientId: string, options?: FindManyOptions<T>): Promise<T[]> {
    return this.activeRepo.find({
      ...options,
      where: { ...(options?.where as object), client_id: clientId } as FindOptionsWhere<T>,
    });
  }

  async findOne(clientId: string, id: string): Promise<T> {
    const record = await this.activeRepo.findOne({
      where: { id, client_id: clientId } as FindOptionsWhere<T>,
    });
    if (!record) throw new NotFoundException('Resource not found');
    return record;
  }

  async create(clientId: string, dto: Record<string, unknown>): Promise<T> {
    const repo = this.activeRepo;
    const entity = repo.create({ ...dto, client_id: clientId } as T);
    return repo.save(entity);
  }

  async update(clientId: string, id: string, dto: Record<string, unknown>): Promise<T> {
    const record = await this.findOne(clientId, id);
    Object.assign(record, dto);
    return this.activeRepo.save(record);
  }

  async remove(clientId: string, id: string): Promise<void> {
    const record = await this.findOne(clientId, id);
    await this.activeRepo.remove(record);
  }

  get raw(): Repository<T> {
    return this.activeRepo;
  }
}