import { Repository, DataSource, EntityTarget, FindManyOptions, FindOptionsWhere } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { TenantBaseEntity } from '../entities/tenant-base.entity';

export class TenantRepository<T extends TenantBaseEntity> {
  private readonly repo: Repository<T>;

  constructor(
    dataSource: DataSource,
    private readonly entity: EntityTarget<T>,
  ) {
    this.repo = dataSource.getRepository(entity);
  }

  findAll(clientId: string, options?: FindManyOptions<T>): Promise<T[]> {
    return this.repo.find({
      ...options,
      where: { ...(options?.where as object), client_id: clientId } as FindOptionsWhere<T>,
    });
  }

  async findOne(clientId: string, id: string): Promise<T> {
    const record = await this.repo.findOne({
      where: { id, client_id: clientId } as FindOptionsWhere<T>,
    });
    if (!record) throw new NotFoundException('Resource not found');
    return record;
  }

  async create(clientId: string, dto: Record<string, unknown>): Promise<T> {
    const entity = this.repo.create({ ...dto, client_id: clientId } as T);
    return this.repo.save(entity);
  }

  async update(clientId: string, id: string, dto: Record<string, unknown>): Promise<T> {
    const record = await this.findOne(clientId, id);
    Object.assign(record, dto);
    return this.repo.save(record);
  }

  async remove(clientId: string, id: string): Promise<void> {
    const record = await this.findOne(clientId, id);
    await this.repo.remove(record);
  }

  get raw(): Repository<T> {
    return this.repo;
  }
}