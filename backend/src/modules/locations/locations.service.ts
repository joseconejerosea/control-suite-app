import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Location } from './entities/location.entity';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

@Injectable()
export class LocationsService {
  private readonly repo: TenantRepository<Location>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = new TenantRepository(dataSource, Location);
  }

  findAll(clientId: string): Promise<Location[]> {
    return this.repo.findAll(clientId);
  }

  findOne(clientId: string, id: string): Promise<Location> {
    return this.repo.findOne(clientId, id);
  }

  create(clientId: string, dto: CreateLocationDto): Promise<Location> {
    return this.repo.create(clientId, dto as unknown as Record<string, unknown>);
  }

  update(clientId: string, id: string, dto: UpdateLocationDto): Promise<Location> {
    return this.repo.update(clientId, id, dto as unknown as Record<string, unknown>);
  }

  remove(clientId: string, id: string): Promise<void> {
    return this.repo.remove(clientId, id);
  }
}