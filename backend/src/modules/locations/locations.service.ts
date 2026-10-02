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

  async create(clientId: string, dto: CreateLocationDto): Promise<Location> {
    // Anexo · dedup a nivel tenant. El índice único de `locations` es PARCIAL
    // (WHERE project_id IS NOT NULL): las locations creadas desde la UI llevan
    // project_id NULL, así que NO lo tocan y se podían duplicar sin límite (y quedar
    // "incompletas" al recrear la misma sin dirección). Chequeamos por lower(name)
    // dentro del tenant; si ya existe una tenant-level, mergeamos los campos provistos
    // (sin pisar con blancos) y la reactivamos, en vez de insertar un duplicado.
    const name = dto.name.trim();
    const existing = (await this.dataSource.query(
      `SELECT id FROM locations
        WHERE client_id = $1 AND project_id IS NULL AND lower(name) = lower($2)
        LIMIT 1`,
      [clientId, name],
    )) as { id: string }[];

    if (existing.length > 0) {
      const patch: Record<string, unknown> = { name, status: dto.status ?? 'active' };
      for (const k of ['address', 'city', 'region', 'postal_code'] as const) {
        const v = dto[k]?.trim();
        if (v) patch[k] = v;
      }
      return this.repo.update(clientId, existing[0].id, patch);
    }
    return this.repo.create(clientId, { ...dto, name } as unknown as Record<string, unknown>);
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