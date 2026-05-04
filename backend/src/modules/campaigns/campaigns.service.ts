import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Campaign } from './entities/campaign.entity';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

@Injectable()
export class CampaignsService {
  private readonly repo: TenantRepository<Campaign>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = new TenantRepository(dataSource, Campaign);
  }

  findAll(clientId: string): Promise<Campaign[]> {
    return this.repo.findAll(clientId, {
      relations: ['location'],
    });
  }

  findOne(clientId: string, id: string): Promise<Campaign> {
    return this.repo.findOne(clientId, id);
  }

  create(clientId: string, dto: CreateCampaignDto): Promise<Campaign> {
    if (new Date(dto.start_date) >= new Date(dto.end_date)) {
      throw new BadRequestException('start_date must be before end_date');
    }
    return this.repo.create(clientId, dto as unknown as Record<string, unknown>);
  }

  update(clientId: string, id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    if (dto.start_date && dto.end_date) {
      if (new Date(dto.start_date) >= new Date(dto.end_date)) {
        throw new BadRequestException('start_date must be before end_date');
      }
    }
    return this.repo.update(clientId, id, dto as unknown as Record<string, unknown>);
  }

  remove(clientId: string, id: string): Promise<void> {
    return this.repo.remove(clientId, id);
  }
}