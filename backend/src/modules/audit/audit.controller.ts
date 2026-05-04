import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('admin/audit')
export class AuditController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get('ai-costs')
  async getAiCosts(@Query('days') days = '30', @Query('client_id') clientId?: string) {
    const d = parseInt(days) || 30;
    const filter = clientId ? `AND client_id='${clientId}'` : '';

    const [total, byClient, byFlow, byDay] = await Promise.all([
      this.ds.query(`
        SELECT 
          COALESCE(SUM(costo_usd),0) as total_usd,
          COALESCE(SUM(input_tokens),0) as total_input,
          COALESCE(SUM(output_tokens),0) as total_output,
          COUNT(*) as total_calls
        FROM ai_costs_log WHERE created_at > NOW() - INTERVAL '${d} days' ${filter}
      `).catch(() => [{ total_usd: 0 }]),

      this.ds.query(`
        SELECT c.nombre, a.client_id,
          COALESCE(SUM(a.costo_usd),0) as costo,
          COUNT(*) as calls
        FROM ai_costs_log a
        LEFT JOIN clients c ON c.id=a.client_id
        WHERE a.created_at > NOW() - INTERVAL '${d} days' ${filter}
        GROUP BY a.client_id, c.nombre
        ORDER BY costo DESC
        LIMIT 10
      `).catch(() => []),

      this.ds.query(`
        SELECT flow, model,
          COALESCE(SUM(costo_usd),0) as costo,
          COUNT(*) as calls
        FROM ai_costs_log
        WHERE created_at > NOW() - INTERVAL '${d} days' ${filter}
        GROUP BY flow, model
        ORDER BY costo DESC
      `).catch(() => []),

      this.ds.query(`
        SELECT DATE(created_at) as dia,
          COALESCE(SUM(costo_usd),0) as costo,
          COUNT(*) as calls
        FROM ai_costs_log
        WHERE created_at > NOW() - INTERVAL '${d} days' ${filter}
        GROUP BY dia
        ORDER BY dia DESC
      `).catch(() => []),
    ]);

    return { total: total[0], byClient, byFlow, byDay };
  }

  @Get('actions')
  async getActionLog() {
    return this.ds.query(`
      SELECT e.id, e.canal, e.processing_status, e.created_at,
        c.nombre as client_nombre
      FROM eventos_crudos e
      LEFT JOIN clients c ON c.id=e.client_id
      ORDER BY e.created_at DESC
      LIMIT 100
    `).catch(() => []);
  }
}
