import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DashboardFiltersDto } from './dto/dashboard-filters.dto';

export interface DashboardOverview {
  client_id: string;
  generated_at: string;
  period: { from: string; to: string };
  kpis: {
    total_projects: number;
    active_campaigns: number;
    total_activations: number;
    activations_completed: number;
    active_promoters: number;
    total_locations: number;
    events_received_24h: number;
    events_processed_24h: number;
    documents_uploaded: number;
    documents_populated: number;
  };
  trends: {
    events_by_day: Array<{ date: string; count: number }>;
    activations_by_week: Array<{ week: string; count: number }>;
  };
}

@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private resolvePeriod(filters: DashboardFiltersDto): { from: string; to: string } {
    const today = new Date();
    const to = filters.to ?? today.toISOString().slice(0, 10);

    // `from` explícito manda. Si no, se deriva del período semántico (day/week/
    // month/year). Default: últimos 30 días (equivale a 'month').
    if (filters.from) return { from: filters.from, to };

    const start = new Date(today);
    switch (filters.period) {
      case 'day':   break;                              // hoy → from = to
      case 'week':  start.setDate(today.getDate() - 7); break;
      case 'year':  start.setDate(today.getDate() - 365); break;
      case 'month':
      default:      start.setDate(today.getDate() - 30); break;
    }
    return { from: start.toISOString().slice(0, 10), to };
  }

  async overview(clientId: string, filters: DashboardFiltersDto): Promise<DashboardOverview> {
    const { from, to } = this.resolvePeriod(filters);
    const projectFilter = filters.project_id ?? null;

    const [kpis] = await this.dataSource.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM projects
          WHERE client_id = $1 AND status <> 'archived')                    AS total_projects,
        (SELECT COUNT(*)::int FROM campaigns
          WHERE client_id = $1 AND status = 'active'
            AND ($4::uuid IS NULL OR project_id = $4))                      AS active_campaigns,
        (SELECT COUNT(*)::int FROM activations
          WHERE client_id = $1
            AND ($4::uuid IS NULL OR project_id = $4))                      AS total_activations,
        (SELECT COUNT(*)::int FROM activations
          WHERE client_id = $1 AND status = 'completed'
            AND ($4::uuid IS NULL OR project_id = $4))                      AS activations_completed,
        (SELECT COUNT(DISTINCT p.id)::int FROM promoters p
           JOIN activations a ON a.promoter_id = p.id
          WHERE p.client_id = $1
            AND ($4::uuid IS NULL OR a.project_id = $4))                    AS active_promoters,
        (SELECT COUNT(*)::int FROM locations
          WHERE client_id = $1)                                             AS total_locations,
        (SELECT COUNT(*)::int FROM eventos_crudos
          WHERE client_id = $1 AND created_at > now() - interval '24 hours')
                                                                             AS events_received_24h,
        (SELECT COUNT(*)::int FROM eventos_crudos
          WHERE client_id = $1 AND status = 'processed'
            AND created_at > now() - interval '24 hours')                  AS events_processed_24h,
        (SELECT COUNT(*)::int FROM document_uploads
          WHERE client_id = $1 AND created_at::date BETWEEN $2 AND $3)      AS documents_uploaded,
        (SELECT COUNT(*)::int FROM document_uploads
          WHERE client_id = $1 AND status = 'populated'
            AND created_at::date BETWEEN $2 AND $3)                         AS documents_populated
      `,
      [clientId, from, to, projectFilter],
    );

    const eventsByDay: Array<{ date: string; count: string }> = await this.dataSource.query(
      `
      SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS count
        FROM eventos_crudos
       WHERE client_id = $1
         AND created_at::date >= (now() - interval '30 days')::date
       GROUP BY created_at::date
       ORDER BY created_at::date ASC
      `,
      [clientId],
    );

    const activationsByWeek: Array<{ week: string; count: string }> = await this.dataSource.query(
      `
      SELECT to_char(date_trunc('week', created_at::date), 'IYYY-"W"IW') AS week,
             COUNT(*)::int AS count
        FROM activations
       WHERE client_id = $1
         AND created_at::date >= (now() - interval '12 weeks')::date
         AND ($2::uuid IS NULL OR project_id = $2)
       GROUP BY date_trunc('week', created_at::date)
       ORDER BY date_trunc('week', created_at::date) ASC
      `,
      [clientId, projectFilter],
    );

    return {
      client_id: clientId,
      generated_at: new Date().toISOString(),
      period: { from, to },
      kpis: {
        total_projects: Number(kpis.total_projects ?? 0),
        active_campaigns: Number(kpis.active_campaigns ?? 0),
        total_activations: Number(kpis.total_activations ?? 0),
        activations_completed: Number(kpis.activations_completed ?? 0),
        active_promoters: Number(kpis.active_promoters ?? 0),
        total_locations: Number(kpis.total_locations ?? 0),
        events_received_24h: Number(kpis.events_received_24h ?? 0),
        events_processed_24h: Number(kpis.events_processed_24h ?? 0),
        documents_uploaded: Number(kpis.documents_uploaded ?? 0),
        documents_populated: Number(kpis.documents_populated ?? 0),
      },
      trends: {
        events_by_day: eventsByDay.map((r) => ({ date: r.date, count: Number(r.count) })),
        activations_by_week: activationsByWeek.map((r) => ({
          week: r.week,
          count: Number(r.count),
        })),
      },
    };
  }

  async campaigns(clientId: string, filters: DashboardFiltersDto) {
    const { from, to } = this.resolvePeriod(filters);
    const projectFilter = filters.project_id ?? null;

    return this.dataSource.query(
      `
      SELECT
        status,
        COUNT(*)::int AS count,
        COALESCE(SUM(budget), 0)::text AS total_budget,
        MIN(start_date) AS earliest_start,
        MAX(end_date)   AS latest_end
      FROM campaigns
      WHERE client_id = $1
        AND created_at::date BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR project_id = $4)
      GROUP BY status
      ORDER BY count DESC
      `,
      [clientId, from, to, projectFilter],
    );
  }

  async activations(clientId: string, filters: DashboardFiltersDto) {
    const { from, to } = this.resolvePeriod(filters);
    const projectFilter = filters.project_id ?? null;

    const byStatus = await this.dataSource.query(
      `
      SELECT status, COUNT(*)::int AS count
        FROM activations
       WHERE client_id = $1
         AND created_at::date BETWEEN $2 AND $3
         AND ($4::uuid IS NULL OR project_id = $4)
       GROUP BY status
       ORDER BY count DESC
      `,
      [clientId, from, to, projectFilter],
    );

    const byCampaign = await this.dataSource.query(
      `
      SELECT c.id AS campaign_id, c.name AS campaign_name,
             COUNT(a.id)::int AS count
        FROM campaigns c
        LEFT JOIN activations a ON a.campaign_id = c.id
                               AND a.created_at::date BETWEEN $2 AND $3
                               AND a.client_id = $1
       WHERE c.client_id = $1
         AND ($4::uuid IS NULL OR c.project_id = $4)
       GROUP BY c.id, c.name
       ORDER BY count DESC
       LIMIT 50
      `,
      [clientId, from, to, projectFilter],
    );

    return { by_status: byStatus, by_campaign: byCampaign };
  }

  async events(clientId: string, filters: DashboardFiltersDto) {
    const { from, to } = this.resolvePeriod(filters);

    const byStatus = await this.dataSource.query(
      `
      SELECT status, COUNT(*)::int AS count
        FROM eventos_crudos
       WHERE client_id = $1
         AND created_at::date BETWEEN $2 AND $3
       GROUP BY status
       ORDER BY count DESC
      `,
      [clientId, from, to],
    );

    const byChannel = await this.dataSource.query(
      `
      SELECT ce.id AS canal_id, ce.nombre AS canal_nombre,
             COUNT(ec.id)::int AS count
        FROM canales_entrada ce
        LEFT JOIN eventos_crudos ec ON ec.canal_id = ce.id
                                   AND ec.created_at::date BETWEEN $2 AND $3
                                   AND ec.client_id = $1
       WHERE ce.client_id = $1
       GROUP BY ce.id, ce.nombre
       ORDER BY count DESC
      `,
      [clientId, from, to],
    );

    return { by_status: byStatus, by_channel: byChannel };
  }

  async documents(clientId: string, filters: DashboardFiltersDto) {
    const { from, to } = this.resolvePeriod(filters);

    const byStatus = await this.dataSource.query(
      `
      SELECT status, COUNT(*)::int AS count
        FROM document_uploads
       WHERE client_id = $1
         AND created_at::date BETWEEN $2 AND $3
       GROUP BY status
       ORDER BY count DESC
      `,
      [clientId, from, to],
    );

    const byTarget = await this.dataSource.query(
      `
      SELECT target_table,
             COUNT(*)::int AS count,
             COALESCE(SUM(rows_inserted), 0)::int AS total_inserted,
             COALESCE(SUM(rows_failed),   0)::int AS total_failed
        FROM document_uploads
       WHERE client_id = $1
         AND target_table IS NOT NULL
         AND created_at::date BETWEEN $2 AND $3
       GROUP BY target_table
       ORDER BY count DESC
      `,
      [clientId, from, to],
    );

    return { by_status: byStatus, by_target: byTarget };
  }
}