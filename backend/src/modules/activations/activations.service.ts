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

  /**
   * List activations enriched with the display names of their related entities
   * (campaign / location / promoter). GET /activations returns raw *_id UUIDs
   * otherwise, which are useless in a table. Client-scoped; RLS is defense-in-depth.
   */
  private listEnriched(
    where: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> {
    return this.dataSource.query(
      `SELECT a.*,
              c.name AS campaign_name,
              l.name AS location_name,
              NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '') AS promoter_name
         FROM activations a
         LEFT JOIN campaigns  c ON c.id = a.campaign_id
         LEFT JOIN locations  l ON l.id = a.location_id
         LEFT JOIN promoters  p ON p.id = a.promoter_id
        ${where}
        ORDER BY a.activation_date DESC NULLS LAST`,
      params,
    );
  }

  findAll(clientId: string): Promise<Record<string, unknown>[]> {
    return this.listEnriched('WHERE a.client_id = $1', [clientId]);
  }

  findByCampaign(
    clientId: string,
    campaignId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.listEnriched(
      'WHERE a.client_id = $1 AND a.campaign_id = $2',
      [clientId, campaignId],
    );
  }

  findByProject(
    clientId: string,
    projectId: string,
  ): Promise<Record<string, unknown>[]> {
    // Activations created via the new UI set campaign_id but not project_id, so
    // the campaign traversal is the reliable link. Match on either association.
    return this.listEnriched(
      `WHERE a.client_id = $1
         AND (a.project_id = $2
              OR a.campaign_id IN (SELECT id FROM campaigns WHERE project_id = $2 AND client_id = $1))`,
      [clientId, projectId],
    );
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

  // Columnas reales (migración 025): las tablas F5 usan `activacion_id` (español);
  // checkins referencia a la persona por `persona_id`; reportes_avance ordena por `ts`.
  async findCheckins(clientId: string, activationId: string): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT c.*, row_to_json(p.*) as promotor
         FROM checkins c
         LEFT JOIN promoters p ON p.id = c.persona_id
         WHERE c.activacion_id = $1 AND c.client_id = $2
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
         WHERE activacion_id = $1 AND client_id = $2
         ORDER BY created_at DESC`,
        [activationId, clientId],
      );
    } catch {
      return [];
    }
  }

  async findReportes(clientId: string, activationId: string): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT * FROM reportes_avance
         WHERE activacion_id = $1 AND client_id = $2
         ORDER BY ts DESC`,
        [activationId, clientId],
      );
    } catch {
      return [];
    }
  }
}
