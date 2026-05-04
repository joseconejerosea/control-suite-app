import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Collaborator } from './collaborator.entity';
import { Project } from '../projects/project.entity';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';

@Injectable()
export class CollaboratorsService {
  private readonly repo: TenantRepository<Collaborator>;
  private readonly projectRepo: TenantRepository<Project>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    // FIXED: argument order is (dataSource, entity)
    this.repo = new TenantRepository<Collaborator>(dataSource, Collaborator);
    this.projectRepo = new TenantRepository<Project>(dataSource, Project);
  }

  private async assertProjectBelongsToClient(
    clientId: string,
    projectId: string | null | undefined,
  ): Promise<void> {
    if (!projectId) return;
    // FIXED: findOne(clientId, id) — method throws NotFoundException if not found.
    // We catch it and convert to BadRequestException for clearer API semantics.
    try {
      await this.projectRepo.findOne(clientId, projectId);
    } catch {
      throw new BadRequestException(`Project ${projectId} does not belong to this client`);
    }
  }

  async create(clientId: string, dto: CreateCollaboratorDto): Promise<Collaborator> {
    await this.assertProjectBelongsToClient(clientId, dto.project_id);

    // FIXED: repo.create() creates AND saves in one call
    return this.repo.create(clientId, {
      full_name: dto.full_name,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      role_label: dto.role_label ?? 'observer',
      project_id: dto.project_id ?? null,
      is_active: dto.is_active ?? true,
      config: dto.config ?? null,
    });
  }

  async findAll(clientId: string, projectId?: string): Promise<Collaborator[]> {
    // FIXED: method name is findAll (not findBy).
    // TenantRepository.findAll merges extra `where` with client_id filter internally.
    const where: Record<string, unknown> = {};
    if (projectId) {
      where.project_id = projectId;
    }
    return this.repo.findAll(clientId, {
      where: where as any,
      order: { created_at: 'DESC' },
    });
  }

  async findOne(clientId: string, id: string): Promise<Collaborator> {
    // FIXED: findOne takes id directly and throws NotFoundException internally.
    // Note: TenantRepository.findOne does NOT support `relations`. If you need
    // the project relation, load it separately or use raw repo via repo.raw.
    return this.repo.findOne(clientId, id);
  }

  async update(
    clientId: string,
    id: string,
    dto: UpdateCollaboratorDto,
  ): Promise<Collaborator> {
    const existing = await this.findOne(clientId, id);

    if (dto.project_id !== undefined) {
      await this.assertProjectBelongsToClient(clientId, dto.project_id);
    }

    // FIXED: use repo.update() instead of Object.assign + save
    return this.repo.update(clientId, id, {
      full_name: dto.full_name ?? existing.full_name,
      email: dto.email ?? existing.email,
      phone: dto.phone ?? existing.phone,
      role_label: dto.role_label ?? existing.role_label,
      project_id: dto.project_id ?? existing.project_id,
      is_active: dto.is_active ?? existing.is_active,
      config: dto.config ?? existing.config,
    });
  }
}