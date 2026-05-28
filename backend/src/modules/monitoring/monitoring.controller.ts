import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';

const SAVINGS_RATE_USD_PER_HOUR = 15;
const HOURS_SAVED_PER_DAY       = 3;

@UseGuards(AuthGuard)
@Controller('admin/monitoring')
export class MonitoringController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  async getMonitoring() {
    const [clients, activations, events, docs, costs] = await Promise.all([
      this.ds.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='active' THEN 1 END) as active FROM clients`).catch(() => [{ total: 0, active: 0 }]),
      this.ds.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='in_progress' THEN 1 END) as live FROM activations`).catch(() => [{ total: 0, live: 0 }]),
      this.ds.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN processing_status='failed' THEN 1 END) as failed FROM eventos_crudos WHERE created_at > NOW() - INTERVAL '24h'`).catch(() => [{ total: 0, failed: 0 }]),
      this.ds.query(`SELECT COUNT(*) as total FROM documents WHERE created_at > NOW() - INTERVAL '24h'`).catch(() => [{ total: 0 }]),
      this.ds.query(`SELECT COALESCE(SUM(costo_usd),0) as total_hoy FROM ai_costs_log WHERE created_at > NOW() - INTERVAL '24h'`).catch(() => [{ total_hoy: 0 }]),
    ]);

    const flows = await this.ds.query(`
      SELECT canal,
        COUNT(*) as total,
        COUNT(CASE WHEN processing_status='processed' THEN 1 END) as ok,
        COUNT(CASE WHEN processing_status='failed' THEN 1 END) as failed
      FROM eventos_crudos
      WHERE created_at > NOW() - INTERVAL '7d'
      GROUP BY canal
    `).catch(() => []);

    return {
      overview: {
        clients:     clients[0],
        activations: activations[0],
        events_24h:  events[0],
        docs_24h:    docs[0],
        ai_cost_hoy: costs[0]?.total_hoy ?? 0,
      },
      flows,
    };
  }

  @Get('clients')
  async getClientStatus() {
    return this.ds.query(`
      SELECT c.id, c.nombre, c.status,
        COUNT(DISTINCT a.id) as activaciones_live,
        COUNT(DISTINCT e.id) as eventos_24h,
        COUNT(DISTINCT CASE WHEN e.processing_status='failed' THEN e.id END) as errores_24h
      FROM clients c
      LEFT JOIN activations a ON a.client_id=c.id AND a.status='in_progress'
      LEFT JOIN eventos_crudos e ON e.client_id=c.id AND e.created_at > NOW() - INTERVAL '24h'
      GROUP BY c.id, c.nombre, c.status
      ORDER BY errores_24h DESC
    `).catch(() => []);
  }

  @Get('financial')
  async getFinancialKpis(@Query('days') daysRaw = '30') {
    const d = Math.min(Math.max(parseInt(daysRaw) || 30, 1), 365);

    const clientRows = await this.ds.query(
      `SELECT id, nombre, plan, status,
         COALESCE((config->>'mrr')::numeric, 0) AS mrr,
         created_at, updated_at
       FROM clients
       WHERE status IN ('active', 'suspended')
       ORDER BY created_at`,
    ).catch(() => []);

    const activeClients    = clientRows.filter((c: any) => c.status === 'active');
    const suspendedClients = clientRows.filter((c: any) => c.status === 'suspended');

    const mrr = activeClients.reduce((sum: number, c: any) => sum + Number(c.mrr ?? 0), 0);
    const arr = mrr * 12;

    const churnedThisPeriod = await this.ds.query(
      `SELECT COUNT(*) as churned FROM clients
       WHERE status IN ('suspended','cancelled')
         AND updated_at > NOW() - MAKE_INTERVAL(days => $1)`,
      [d],
    ).catch(() => [{ churned: 0 }]);

    const totalAtStart = await this.ds.query(
      `SELECT COUNT(*) as total FROM clients
       WHERE created_at < NOW() - MAKE_INTERVAL(days => $1)`,
      [d],
    ).catch(() => [{ total: 1 }]);

    const churnedCount = Number(churnedThisPeriod[0]?.churned ?? 0);
    const startCount   = Math.max(Number(totalAtStart[0]?.total ?? 1), 1);
    const churnRate    = parseFloat(((churnedCount / startCount) * 100).toFixed(1));

    const mrrPerClient = activeClients.length > 0 ? mrr / activeClients.length : 0;
    const monthlyChurn = churnRate / 100 || 0.01;
    const ltv          = parseFloat((mrrPerClient / monthlyChurn).toFixed(0));

    const savingsUsd = activeClients.length * HOURS_SAVED_PER_DAY * SAVINGS_RATE_USD_PER_HOUR * d;

    const aiCost = await this.ds.query(
      `SELECT COALESCE(SUM(cost_usd), 0) as total FROM ai_costs_log
       WHERE created_at > NOW() - MAKE_INTERVAL(days => $1)`,
      [d],
    ).catch(() => [{ total: 0 }]);

    const aiCostTotal = Number(aiCost[0]?.total ?? 0);
    const margin      = mrr - aiCostTotal;

    return {
      periodo_dias: d,
      mrr: {
        value: parseFloat(mrr.toFixed(2)), label: 'MRR (USD)',
        formula: "SUM(clients.config->>'mrr') WHERE status='active'",
        source_tables: ['clients'],
        source_rows: activeClients.map((c: any) => ({ cliente: c.nombre, plan: c.plan, mrr: Number(c.mrr) })),
      },
      arr: {
        value: parseFloat(arr.toFixed(2)), label: 'ARR (USD)',
        formula: 'MRR × 12', source_tables: ['clients'],
      },
      churn_rate: {
        value: churnRate, label: 'Churn Rate (%)',
        formula: `(churned_clients_last_${d}d / clients_at_start) × 100`,
        source_tables: ['clients'], churned: churnedCount, start_count: startCount,
      },
      ltv: {
        value: ltv, label: 'LTV (USD)',
        formula: '(MRR / active_clients) / monthly_churn_rate',
        source_tables: ['clients'],
      },
      savings: {
        value: parseFloat(savingsUsd.toFixed(0)), label: `Savings Generated (USD, ${d}d)`,
        formula: `active_clients(${activeClients.length}) × ${HOURS_SAVED_PER_DAY}h/day × $${SAVINGS_RATE_USD_PER_HOUR}/h × ${d} days`,
        source_tables: ['clients'],
      },
      margin: {
        value: parseFloat(margin.toFixed(2)), label: 'Platform Margin (USD)',
        formula: 'MRR - total_ai_cost_period',
        source_tables: ['clients', 'ai_costs_log'],
        ai_cost: parseFloat(aiCostTotal.toFixed(2)), negative: margin < 0,
      },
      active_clients:    activeClients.length,
      suspended_clients: suspendedClients.length,
      total_clients:     clientRows.length,
    };
  }
}