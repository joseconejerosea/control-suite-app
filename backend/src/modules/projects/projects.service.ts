import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

export interface ProjectSummary {
  project_id: string;
  name: string;
  status: string;
  total_campaigns: number;
  total_activations: number;
  active_promoters: number;
  budget_allocated: string | null;
  budget_used: string;
}

@Injectable()
export class ProjectsService {
  private readonly repo: TenantRepository<Project>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.repo = new TenantRepository<Project>(dataSource, Project);
  }

  async create(clientId: string, dto: CreateProjectDto): Promise<Project> {
    if (dto.start_date && dto.end_date && dto.start_date > dto.end_date) {
      throw new BadRequestException('start_date cannot be after end_date');
    }

  
    return this.repo.create(clientId, {
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status ?? 'active',
      start_date: dto.start_date ?? null,
      end_date: dto.end_date ?? null,
      budget: dto.budget ?? null,
      config: dto.config ?? null,
    });
  }

  async findAll(clientId: string): Promise<Project[]> {

    return this.repo.findAll(clientId, {
      order: { created_at: 'DESC' },
    });
  }

  async findOne(clientId: string, id: string): Promise<Project> {
    return this.repo.findOne(clientId, id);
  }

  async update(clientId: string, id: string, dto: UpdateProjectDto): Promise<Project> {
    const existing = await this.findOne(clientId, id);

    const nextStart = dto.start_date ?? existing.start_date;
    const nextEnd = dto.end_date ?? existing.end_date;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      throw new BadRequestException('start_date cannot be after end_date');
    }

   
    return this.repo.update(clientId, id, {
      name: dto.name ?? existing.name,
      description: dto.description ?? existing.description,
      status: dto.status ?? existing.status,
      start_date: dto.start_date ?? existing.start_date,
      end_date: dto.end_date ?? existing.end_date,
      budget: dto.budget ?? existing.budget,
      config: dto.config ?? existing.config,
    });
  }

  async summary(clientId: string, id: string): Promise<ProjectSummary> {
    const project = await this.findOne(clientId, id);

    const [counts] = await this.dataSource.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM campaigns      WHERE client_id = $1 AND project_id = $2) AS total_campaigns,
        (SELECT COUNT(*)::int FROM activations    WHERE client_id = $1 AND project_id = $2) AS total_activations,
        (SELECT COUNT(DISTINCT p.id)::int
           FROM promoters p
           JOIN activations a ON a.promoter_id = p.id
          WHERE p.client_id = $1 AND a.project_id = $2)                                      AS active_promoters,
        COALESCE((SELECT SUM(budget)::numeric FROM campaigns
                   WHERE client_id = $1 AND project_id = $2), 0)::text                       AS budget_used
      `,
      [clientId, id],
    );

    return {
      project_id: project.id,
      name: project.name,
      status: project.status,
      total_campaigns: Number(counts.total_campaigns ?? 0),
      total_activations: Number(counts.total_activations ?? 0),
      active_promoters: Number(counts.active_promoters ?? 0),
      budget_allocated: project.budget,
      budget_used: counts.budget_used ?? '0',
    };
  }
}