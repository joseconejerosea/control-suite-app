import { Injectable, ConflictException } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Promoter } from './entities/promoter.entity';
import { CreatePromoterDto, UpdatePromoterDto } from './dto/promoter.dto';
import { isRota } from '../../common/promoter-role/role-rota.util';

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
    // rota se deriva server-side; el cliente no puede establecerlo (spec I-6).
    const payload: Record<string, unknown> = {
      ...(dto as unknown as Record<string, unknown>),
      rota: isRota((dto as any).rol_tipo),
    };
    return this.repo.create(clientId, payload);
  }

  update(clientId: string, id: string, dto: UpdatePromoterDto): Promise<Promoter> {
    const payload: Record<string, unknown> = {
      ...(dto as unknown as Record<string, unknown>),
    };
    // rota se deriva server-side (spec I-6), pero SOLO cuando el update trae rol_tipo.
    // En un update parcial sin rol_tipo no se recalcula, para no pisar el valor guardado
    // (ej: un supervisor rota=false que edita otro campo no debe volverse rota=true).
    if ((dto as any).rol_tipo !== undefined) {
      payload.rota = isRota((dto as any).rol_tipo);
    }
    return this.repo.update(clientId, id, payload);
  }

  remove(clientId: string, id: string): Promise<void> {
    return this.repo.remove(clientId, id);
  }
}