import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { AuditLogFiltersDto } from './dto/audit-log-filters.dto';

@UseGuards(AuthGuard, RolesGuard)
@Controller()
export class AuditController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // ── Global audit log (superadmin) ─────────────────────────────────────────
  @Get('admin/audit-log')
  @Roles('super_admin')
  async getAdminAuditLog(@Query() filters: AuditLogFiltersDto) {
    return this.auditService.findAll(filters);
  }

  // ── Tenant audit log (operator) ───────────────────────────────────────────
  @Get('app/audit-log')
  async getAppAuditLog(@Query() filters: AuditLogFiltersDto, @Req() req: any) {
    const tenantId = req.user?.client_id ?? req.user?.clientId;
    return this.auditService.findAll(filters, tenantId);
  }

  // ── AI cost tracking (existing) ───────────────────────────────────────────
  @Get('admin/audit/ai-costs')
  @Roles('super_admin')
  async getAiCosts(
    @Query('days')      daysRaw    = '30',
    @Query('client_id') clientId?: string,
  ) {
    const d          = Math.min(Math.max(parseInt(daysRaw) || 30, 1), 365);
    const hasClient  = !!clientId;
    const baseParams = hasClient ? [d, clientId] : [d];

    const [total, byClient, byFlow, byDay] = await Promise.all([
      this.ds.query(
        `SELECT
           COALESCE(SUM(cost_usd), 0)      AS total_usd,
           COALESCE(SUM(input_tokens), 0)  AS total_input,
           COALESCE(SUM(output_tokens), 0) AS total_output,
           COUNT(*)                         AS total_calls
         FROM ai_costs_log
         WHERE created_at > NOW() - MAKE_INTERVAL(days => $1)
           ${hasClient ? 'AND client_id = $2' : ''}`,
        baseParams,
      ).catch(() => [{ total_usd: 0, total_input: 0, total_output: 0, total_calls: 0 }]),

      this.ds.query(
        `SELECT c.nombre, a.client_id,
           COALESCE(SUM(a.cost_usd), 0) AS costo,
           COUNT(*)                      AS calls
         FROM ai_costs_log a
         LEFT JOIN clients c ON c.id = a.client_id
         WHERE a.created_at > NOW() - MAKE_INTERVAL(days => $1)
           ${hasClient ? 'AND a.client_id = $2' : ''}
         GROUP BY a.client_id, c.nombre
         ORDER BY costo DESC
         LIMIT 10`,
        baseParams,
      ).catch(() => []),

      this.ds.query(
        `SELECT flow, model,
           COALESCE(SUM(cost_usd), 0) AS costo,
           COUNT(*)                    AS calls
         FROM ai_costs_log
         WHERE created_at > NOW() - MAKE_INTERVAL(days => $1)
           ${hasClient ? 'AND client_id = $2' : ''}
         GROUP BY flow, model
         ORDER BY costo DESC`,
        baseParams,
      ).catch(() => []),

      this.ds.query(
        `SELECT DATE(created_at) AS dia,
           COALESCE(SUM(cost_usd), 0) AS costo,
           COUNT(*)                    AS calls
         FROM ai_costs_log
         WHERE created_at > NOW() - MAKE_INTERVAL(days => $1)
           ${hasClient ? 'AND client_id = $2' : ''}
         GROUP BY dia
         ORDER BY dia DESC`,
        baseParams,
      ).catch(() => []),
    ]);

    return { total: total[0], byClient, byFlow, byDay };
  }

  @Get('admin/audit/actions')
  @Roles('super_admin')
  async getActionLog() {
    return this.ds.query(
      `SELECT e.id, e.canal, e.processing_status, e.created_at,
         c.nombre AS client_nombre
       FROM eventos_crudos e
       LEFT JOIN clients c ON c.id = e.client_id
       ORDER BY e.created_at DESC
       LIMIT 100`,
    ).catch(() => []);
  }

  @Get('admin/audit/margin-per-client')
  @Roles('super_admin')
  async getMarginPerClient(@Query('days') daysRaw = '30') {
    const d = Math.min(Math.max(parseInt(daysRaw) || 30, 1), 365);

    const rows = await this.ds.query(
      `SELECT
         c.id                                              AS client_id,
         c.nombre                                          AS cliente,
         c.plan,
         COALESCE((c.config->>'mrr')::numeric, 0)         AS mrr_usd,
         COALESCE(SUM(a.cost_usd), 0)                     AS costo_ia_usd,
         COALESCE((c.config->>'mrr')::numeric, 0)
           - COALESCE(SUM(a.cost_usd), 0)                 AS margen_usd,
         CASE
           WHEN COALESCE((c.config->>'mrr')::numeric, 0)
              - COALESCE(SUM(a.cost_usd), 0) < 0
           THEN true ELSE false
         END                                               AS margen_negativo,
         COUNT(a.id)                                       AS total_llamadas_ia
       FROM clients c
       LEFT JOIN ai_costs_log a
         ON a.client_id = c.id
        AND a.created_at > NOW() - MAKE_INTERVAL(days => $1)
       WHERE c.status = 'active'
       GROUP BY c.id, c.nombre, c.plan, c.config
       ORDER BY margen_usd ASC`,
      [d],
    ).catch(() => []);

    return {
      periodo_dias:     d,
      clientes:         rows,
      negativos:        rows.filter((r: { margen_negativo: boolean }) => r.margen_negativo).length,
      total_clientes:   rows.length,
    };
  }
}
