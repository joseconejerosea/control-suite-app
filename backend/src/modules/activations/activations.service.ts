import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Activation } from './entities/activation.entity';
import { CreateActivationDto, UpdateActivationDto } from './dto/activation.dto';

@Injectable()
export class ActivationsService {
  private readonly logger = new Logger(ActivationsService.name);
  private readonly repo: TenantRepository<Activation>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = new TenantRepository(dataSource, Activation);
  }

  findAll(clientId: string): Promise<Activation[]> {
    return this.repo.findAll(clientId, {
      order: { activation_date: 'DESC' },
    });
  }

  findByCampaign(clientId: string, campaignId: string): Promise<Activation[]> {
    return this.repo.raw
      .createQueryBuilder('a')
      .where('a.client_id = :clientId', { clientId })
      .andWhere('a.campaign_id = :campaignId', { campaignId })
      .orderBy('a.activation_date', 'DESC')
      .getMany();
  }

  findOne(clientId: string, id: string): Promise<Activation> {
    return this.repo.findOne(clientId, id);
  }

  async create(clientId: string, dto: CreateActivationDto): Promise<Activation> {
    const activation = await this.repo.create(clientId, dto as unknown as Record<string, unknown>);
    this.logger.log(`Activation created [id=${activation.id}]`);
    return activation;
  }

  update(clientId: string, id: string, dto: UpdateActivationDto): Promise<Activation> {
    return this.repo.update(clientId, id, dto as unknown as Record<string, unknown>);
  }

  remove(clientId: string, id: string): Promise<void> {
    return this.repo.remove(clientId, id);
  }

  // ── F5 sub-resources ──────────────────────────────────────────────

  async findCheckins(clientId: string, activationId: string): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT c.*, row_to_json(p.*) as promotor
         FROM checkins c
         LEFT JOIN promoters p ON p.id = c.promoter_id
         WHERE c.activation_id = $1 AND c.client_id = $2
         ORDER BY c.ts DESC`,
        [activationId, clientId],
      );
    } catch {
      return [];
    }
  }

  async findIncidencias(clientId: string, activationId: string): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT * FROM incidencias
         WHERE activation_id = $1 AND client_id = $2
         ORDER BY created_at DESC`,
        [activationId, clientId],
      );
    } catch {
      try {
        return await this.dataSource.query(
          `SELECT * FROM incidences
           WHERE activation_id = $1 AND client_id = $2
           ORDER BY created_at DESC`,
          [activationId, clientId],
        );
      } catch {
        return [];
      }
    }
  }

  async findReportes(clientId: string, activationId: string): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT * FROM reportes_avance
         WHERE activation_id = $1 AND client_id = $2
         ORDER BY created_at DESC`,
        [activationId, clientId],
      );
    } catch {
      return [];
    }
  }
}