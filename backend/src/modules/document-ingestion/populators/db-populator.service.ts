import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../../common/repositories/tenant.repository';
import { Promoter } from '../../promoters/entities/promoter.entity';
import { Location } from '../../locations/entities/location.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { Activation } from '../../activations/entities/activation.entity';
import { Collaborator } from '../../collaborators/collaborator.entity';
import { TargetTable } from '../document-upload.entity';

export interface PopulateResult {
  inserted: number;
  failed: number;
  errors: Array<{ row_index: number; reason: string }>;
}

@Injectable()
export class DbPopulatorService {
  private readonly logger = new Logger(DbPopulatorService.name);

  constructor(private readonly dataSource: DataSource) {}

  async populate(
    clientId: string,
    targetTable: TargetTable,
    rows: Record<string, unknown>[],
    projectId?: string | null,
    continueOnError = true,
  ): Promise<PopulateResult> {
    let inserted = 0;
    let failed = 0;
    const errors: Array<{ row_index: number; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        await this.insertRow(clientId, targetTable, rows[i], projectId ?? null);
        inserted++;
      } catch (err) {
        failed++;
        const reason = err instanceof Error ? err.message : 'Unknown insertion error';
        errors.push({ row_index: i, reason });
        this.logger.warn(`Row ${i} failed in ${targetTable}: ${reason}`);
        if (!continueOnError) break;
      }
    }

    return { inserted, failed, errors };
  }

  private async insertRow(
    clientId: string,
    targetTable: TargetTable,
    row: Record<string, unknown>,
    projectId: string | null,
  ): Promise<void> {
    switch (targetTable) {
      case 'promoters':
        return this.insertPromoter(clientId, row);
      case 'locations':
        return this.insertLocation(clientId, row);
      case 'campaigns':
        return this.insertCampaign(clientId, row, projectId);
      case 'activations':
        return this.insertActivation(clientId, row, projectId);
      case 'collaborators':
        return this.insertCollaborator(clientId, row, projectId);
    }
  }

  // ✅ FIXED: upsert instead of insert to prevent duplicates
  private async insertPromoter(clientId: string, row: Record<string, unknown>): Promise<void> {
  const repo = new TenantRepository<Promoter>(this.dataSource, Promoter);
  await repo.raw.upsert(
    {
      client_id: clientId,
      first_name: String(row.first_name),
      last_name: String(row.last_name),
      email: String(row.email),
      phone: row.phone ? String(row.phone) : null,
      rut: row.rut ? String(row.rut) : null,
      status: 'active',
    },
    ['email', 'client_id'],
  );
}
  private async insertLocation(clientId: string, row: Record<string, unknown>): Promise<void> {
    const repo = new TenantRepository<Location>(this.dataSource, Location);
    await repo.create(clientId, {
      name: String(row.name),
      address: row.address ? String(row.address) : null,
      city: row.city ? String(row.city) : null,
      region: row.region ? String(row.region) : null,
      country: row.country ? String(row.country) : null,
      latitude: row.latitude ? parseFloat(String(row.latitude)) : null,
      longitude: row.longitude ? parseFloat(String(row.longitude)) : null,
      notes: row.notes ? String(row.notes) : null,
    });
  }

  private async insertCampaign(
    clientId: string,
    row: Record<string, unknown>,
    projectId: string | null,
  ): Promise<void> {
    const repo = new TenantRepository<Campaign>(this.dataSource, Campaign);
    await repo.create(clientId, {
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      start_date: String(row.start_date).slice(0, 10),
      end_date: String(row.end_date).slice(0, 10),
      budget: row.budget ? String(row.budget) : null,
      status: row.status ? String(row.status) : 'draft',
      project_id: projectId,
    });
  }

  private async insertActivation(
    clientId: string,
    row: Record<string, unknown>,
    projectId: string | null,
  ): Promise<void> {
    const activationRepo = new TenantRepository<Activation>(this.dataSource, Activation);
    const campaignRepo = new TenantRepository<Campaign>(this.dataSource, Campaign);
    const locationRepo = new TenantRepository<Location>(this.dataSource, Location);
    const promoterRepo = new TenantRepository<Promoter>(this.dataSource, Promoter);

    let campaignId = row.campaign_id ? String(row.campaign_id) : null;
    if (!campaignId && row.campaign_name) {
      const campaign = await campaignRepo.raw.findOne({
        where: { name: String(row.campaign_name), client_id: clientId } as any,
      });
      if (!campaign) {
        throw new Error(`Campaign "${String(row.campaign_name)}" not found for this client`);
      }
      campaignId = campaign.id;
    }

    let locationId: string | null = null;
    if (row.location_name) {
      const loc = await locationRepo.raw.findOne({
        where: { name: String(row.location_name), client_id: clientId } as any,
      });
      locationId = loc?.id ?? null;
    }

    let promoterId: string | null = null;
    if (row.promoter_email) {
      const prom = await promoterRepo.raw.findOne({
        where: { email: String(row.promoter_email), client_id: clientId } as any,
      });
      promoterId = prom?.id ?? null;
    }

    await activationRepo.create(clientId, {
      campaign_id: campaignId,
      location_id: locationId,
      promoter_id: promoterId,
      activation_date: String(row.activation_date).slice(0, 10),
      status: row.status ? String(row.status) : 'scheduled',
      notes: row.notes ? String(row.notes) : null,
      project_id: projectId,
    });
  }

  private async insertCollaborator(
    clientId: string,
    row: Record<string, unknown>,
    projectId: string | null,
  ): Promise<void> {
    const repo = new TenantRepository<Collaborator>(this.dataSource, Collaborator);
    await repo.create(clientId, {
      full_name: String(row.full_name),
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      role_label: (row.role_label as Collaborator['role_label']) ?? 'observer',
      project_id: projectId,
      is_active: true,
    });
  }
}