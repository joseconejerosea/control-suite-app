import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Campaign } from './entities/campaign.entity';
import { Project } from '../projects/project.entity';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

@Injectable()
export class CampaignsService {
  private readonly repo: TenantRepository<Campaign>;
  private readonly projectRepo: TenantRepository<Project>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = new TenantRepository(dataSource, Campaign);
    this.projectRepo = new TenantRepository<Project>(dataSource, Project);
  }

  private async assertProjectBelongsToClient(
    clientId: string,
    projectId: string | null | undefined,
  ): Promise<void> {
    if (!projectId) return;
    // projectRepo.findOne(clientId, id) throws NotFoundException if the project
    // does not belong to this client; convert to BadRequestException for clearer
    // API semantics (mirrors CollaboratorsService).
    try {
      await this.projectRepo.findOne(clientId, projectId);
    } catch {
      throw new BadRequestException(`Project ${projectId} does not belong to this client`);
    }
  }

  findAll(clientId: string, projectId?: string): Promise<Campaign[]> {
    const where: Record<string, unknown> = {};
    if (projectId) {
      where.project_id = projectId;
    }
    return this.repo.findAll(clientId, {
      where: where as any,
      relations: ['location'],
    });
  }

  findOne(clientId: string, id: string): Promise<Campaign> {
    return this.repo.findOne(clientId, id);
  }

  async create(clientId: string, dto: CreateCampaignDto): Promise<Campaign> {
    if (new Date(dto.start_date) >= new Date(dto.end_date)) {
      throw new BadRequestException('start_date must be before end_date');
    }
    await this.assertProjectBelongsToClient(clientId, dto.project_id);
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