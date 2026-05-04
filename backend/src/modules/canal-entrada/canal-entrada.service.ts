import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { CanalEntrada } from './canal-entrada.entity';
import {
  CreateCanalEntradaDto,
  UpdateCanalEntradaDto,
} from './dto/canal-entrada.dto';

@Injectable()
export class CanalEntradaService {
  private readonly repo: TenantRepository<CanalEntrada>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = new TenantRepository(dataSource, CanalEntrada);
  }

  findAll(clientId: string): Promise<CanalEntrada[]> {
    return this.repo.findAll(clientId);
  }

  findOne(clientId: string, id: string): Promise<CanalEntrada> {
    return this.repo.findOne(clientId, id);
  }

  create(clientId: string, dto: CreateCanalEntradaDto): Promise<CanalEntrada> {
    return this.repo.create(clientId, dto as unknown as Record<string, unknown>);
  }

  update(
    clientId: string,
    id: string,
    dto: UpdateCanalEntradaDto,
  ): Promise<CanalEntrada> {
    return this.repo.update(clientId, id, dto as unknown as Record<string, unknown>);
  }

  async remove(clientId: string, id: string): Promise<void> {
    await this.repo.remove(clientId, id);
  }
}