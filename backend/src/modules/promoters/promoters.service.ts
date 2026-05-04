import { Injectable, ConflictException } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Promoter } from './entities/promoter.entity';
import { CreatePromoterDto, UpdatePromoterDto } from './dto/promoter.dto';

@Injectable()
export class PromotersService {
  private readonly repo: TenantRepository<Promoter>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = new TenantRepository(dataSource, Promoter);
  }

  findAll(clientId: string): Promise<Promoter[]> {
    return this.repo.findAll(clientId);
  }

  findOne(clientId: string, id: string): Promise<Promoter> {
    return this.repo.findOne(clientId, id);
  }

  async create(clientId: string, dto: CreatePromoterDto): Promise<Promoter> {
    const existing = await this.repo.raw.findOne({
      where: { email: dto.email, client_id: clientId } as FindOptionsWhere<Promoter>,
    });
    if (existing) {
      throw new ConflictException('A promoter with this email already exists');
    }
    return this.repo.create(clientId, dto as unknown as Record<string, unknown>);
  }

  update(clientId: string, id: string, dto: UpdatePromoterDto): Promise<Promoter> {
    return this.repo.update(clientId, id, dto as unknown as Record<string, unknown>);
  }

  remove(clientId: string, id: string): Promise<void> {
    return this.repo.remove(clientId, id);
  }
}