import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Location } from './entities/location.entity';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

export interface ProjectLocationRow {
  id: string;
  name: string;
  address: string | null;
}

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

  /**
   * B5 — Returns only active locations linked to the given project, tenant-scoped.
   * Used by GET /projects/:id/locations for the PDV dropdown.
   */
  findByProject(clientId: string, projectId: string): Promise<ProjectLocationRow[]> {
    return this.dataSource.query<ProjectLocationRow[]>(
      `SELECT id, name, address
         FROM locations
        WHERE client_id = $1
          AND project_id = $2
          AND status = 'active'
        ORDER BY name ASC`,
      [clientId, projectId],
    );
  }
}