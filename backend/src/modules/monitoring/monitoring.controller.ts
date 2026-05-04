import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthGuard } from '../../common/guards/auth.guard';

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
        clients: clients[0],
        activations: activations[0],
        events_24h: events[0],
        docs_24h: docs[0],
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
}
