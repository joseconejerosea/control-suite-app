import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';
import { QUEUE_MIND_PROACTIVE } from '../queue/queue.module';
import { RendicionesService } from '../rendiciones/rendiciones.service';
import { runWithTenant, runAsSystem } from '../../common/tenant/tenant-context';

// Brief: F5 hourly mini-reports use Haiku (cheap), not Opus
const F5_CRON_MODEL     = 'claude-haiku-4-5-20251001';
const HAIKU_INPUT_PRICE = 0.00000080;
const HAIKU_OUTPUT_PRICE = 0.00000400;

// Brief: sales-invoice reminder — days without billing before alert
const BILLING_ALERT_DAYS = 7;

@Injectable()
export class CronService {
  private readonly logger    = new Logger(CronService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUE_MIND_PROACTIVE) private readonly mindQueue: Queue,
    private readonly rendicionesService: RendicionesService,
  ) {}

  // ── F5: Hourly mini-reports for live activations ──────────────────────────
  // Brief §F5: "Hourly reports: AI processes WA inputs each hour, generates
  //             internal mini-report, alerts PM on critical issues"
  // Fase 2: la lista de activaciones es cross-tenant (runAsSystem); el proceso
  // de cada una corre en la tx de su tenant (runWithTenant).
  @Cron('0 * * * *')
  async hourlyF5Reports(): Promise<void> {
    this.logger.log('[Cron] Hourly F5 reports running...');
    try {
      const activaciones = await runAsSystem(() =>
        this.ds.query(`SELECT id, client_id FROM activations WHERE estado_f5='en_vivo' AND status='in_progress'`),
      ).catch(() => []);

      for (const act of activaciones) {
        await runWithTenant(this.ds, act.client_id, async () => {
          const [ch, inc, mov] = await Promise.all([
            this.ds.query(`SELECT COUNT(*) as c FROM checkins WHERE activacion_id=$1`, [act.id]).catch(() => [{ c: 0 }]),
            this.ds.query(`SELECT COUNT(*) as c FROM incidencias WHERE activacion_id=$1 AND estado='abierta'`, [act.id]).catch(() => [{ c: 0 }]),
            this.ds.query(`SELECT COUNT(*) as c FROM movimientos_pop WHERE activacion_id=$1 AND tipo='consumo'`, [act.id]).catch(() => [{ c: 0 }]),
          ]);

          const resp = await this.anthropic.messages.create({
            model:      F5_CRON_MODEL,
            max_tokens: 150,
            system:     'Eres el asistente BTL de Control Suite. Responde en español, máximo 2 líneas, sin formato markdown.',
            messages:   [{ role: 'user', content: `Activación en vivo. Check-ins: ${ch[0]?.c}. Incidencias abiertas: ${inc[0]?.c}. Movimientos POP consumo: ${mov[0]?.c}. Genera mini-reporte ejecutivo.` }],
          });

          const texto = (resp.content[0] as { type: string; text: string }).text;
          const costo = (resp.usage.input_tokens * HAIKU_INPUT_PRICE) + (resp.usage.output_tokens * HAIKU_OUTPUT_PRICE);

          await this.ds.query(
            `INSERT INTO ai_costs_log (client_id, flow, model, input_tokens, output_tokens, cost_usd, description)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [act.client_id, 'f5_hourly', F5_CRON_MODEL, resp.usage.input_tokens, resp.usage.output_tokens, costo, `F5 mini-report act=${act.id}`],
          ).catch(() => {});

          await this.ds.query(
            `INSERT INTO reportes_avance (activacion_id, client_id, tipo, contenido, generado_por_ia, created_at)
             VALUES ($1,$2,'hourly_ai',$3,true,NOW())`,
            [act.id, act.client_id, texto],
          ).catch(() => {});

          if (Number(inc[0]?.c) > 0) {
            this.logger.warn(`[CronF5] Activación ${act.id} tiene ${inc[0].c} incidencia(s) abierta(s) — alertar PM`);
          }
        }).catch((err) =>
          this.logger.error(`[CronF5] cliente ${act.client_id}:`, err instanceof Error ? err.message : err),
        );
      }
      this.logger.log(`[Cron] F5 done — ${activaciones.length} activations processed`);
    } catch (err) {
      this.logger.error('[Cron] F5 error:', err instanceof Error ? err.message : err);
    }
  }

  // ── Mind Proactive: every 4h ──────────────────────────────────────────────
  @Cron('0 */4 * * *')
  async dispatchMindProactive(): Promise<void> {
    this.logger.log('[Cron] Proactive Mind — dispatching jobs for all active clients...');
    try {
      const clients = await runAsSystem(() =>
        this.ds.query(`SELECT id FROM clients WHERE status='active'`),
      ).catch(() => []);

      for (const client of clients) {
        await this.mindQueue.add(
          'proactive',
          { client_id: client.id },
          { attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
        );
      }
      this.logger.log(`[Cron] Proactive Mind — ${clients.length} jobs queued`);
    } catch (err) {
      this.logger.error('[Cron] Proactive Mind error:', err instanceof Error ? err.message : err);
    }
  }

  // ── F1: Sales-invoice reminder ────────────────────────────────────────────
  // Brief §F2: "if a project is X days old without billing, alert client"
  // Runs daily at 09:00
  @Cron('0 9 * * *')
  async salesInvoiceReminder(): Promise<void> {
    this.logger.log('[Cron] Sales-invoice reminder running...');
    try {
      // Find active projects older than BILLING_ALERT_DAYS with no sales invoice
      const proyectos = await runAsSystem(() =>
        this.ds.query(
          `SELECT p.id, p.name, p.client_id, p.created_at,
                  c.nombre AS cliente_nombre
             FROM projects p
             JOIN clients c ON c.id = p.client_id
            WHERE p.status = 'active'
              AND p.created_at < NOW() - MAKE_INTERVAL(days => $1)
              AND NOT EXISTS (
                SELECT 1 FROM invoices i
                 WHERE i.client_id = p.client_id
                   AND i.project_id = p.id
                   AND i.tipo = 'venta'
                   AND i.status NOT IN ('rejected','failed_ocr')
              )`,
          [BILLING_ALERT_DAYS],
        ),
      ).catch(() => []);

      for (const p of proyectos) {
        const diasSinFactura = Math.floor(
          (Date.now() - new Date(p.created_at).getTime()) / 86_400_000,
        );

        // Insert Mind proactive proposal so it appears in the dashboard
        await runWithTenant(this.ds, p.client_id, () =>
          this.ds.query(
            `INSERT INTO mind_propuestas
               (client_id, tipo, titulo, descripcion, datos_soporte, prioridad, estado, created_at)
             VALUES ($1, 'alerta_facturacion', $2, $3, $4::jsonb, 'alta', 'pendiente', NOW())
             ON CONFLICT DO NOTHING`,
            [
              p.client_id,
              `Proyecto "${p.name}" sin factura de venta`,
              `El proyecto lleva ${diasSinFactura} días activo sin registrar una factura de venta. ` +
                `Verifica si ya fue emitida o si hay una gestión pendiente.`,
              JSON.stringify({
                project_id:       p.id,
                project_name:     p.name,
                dias_sin_factura: diasSinFactura,
                formula:          `DATEDIFF(NOW(), projects.created_at) = ${diasSinFactura} días, invoices tipo=venta COUNT=0`,
                source_tables:    ['projects', 'invoices'],
              }),
            ],
          ),
        ).catch(() => {});

        this.logger.log(
          `[CronBilling] Alerta generada: proyecto "${p.name}" (${diasSinFactura}d sin factura) cliente=${p.client_id}`,
        );
      }

      this.logger.log(`[Cron] Sales-invoice reminder done — ${proyectos.length} alertas`);
    } catch (err) {
      this.logger.error('[Cron] Sales-invoice reminder error:', err instanceof Error ? err.message : err);
    }
  }

  // ── F3: 24h return reminder — daily at 10:00 UTC ──
  @Cron('0 10 * * *')
  async returnReminder24h(): Promise<void> {
    this.logger.log('[Cron] Return reminder 24h running...');
    try {
      const overdue = await runAsSystem(() =>
        this.ds.query(
          `SELECT srr.id, srr.client_id, srr.project_id, srr.persona_id,
                  p.name as project_name,
                  EXTRACT(EPOCH FROM (NOW() - srr.requested_at))/3600 as hours
           FROM stock_return_requests srr
           JOIN projects p ON p.id = srr.project_id
           WHERE srr.status = 'pending'
             AND srr.photo_key IS NULL
             AND srr.requested_at < NOW() - INTERVAL '24 hours'`,
        ),
      ).catch(() => []);

      for (const row of overdue) {
        await runWithTenant(this.ds, row.client_id, () =>
          this.ds.query(
            `INSERT INTO mind_propuestas
               (client_id, tipo, titulo, descripcion, datos_soporte, prioridad, estado, created_at)
             VALUES ($1, 'alerta_devolucion', $2, $3, $4::jsonb, 'alta', 'pendiente', NOW())
             ON CONFLICT DO NOTHING`,
            [
              row.client_id,
              `Devolución pendiente: proyecto "${row.project_name}"`,
              `Han pasado más de ${Math.floor(row.hours)}h sin respuesta de devolución de material POP.`,
              JSON.stringify({ return_request_id: row.id, project_id: row.project_id, persona_id: row.persona_id }),
            ],
          ),
        ).catch(() => {});
      }

      this.logger.log(`[Cron] Return reminder done — ${overdue.length} overdue`);
    } catch (err) {
      this.logger.error('[Cron] Return reminder error:', err instanceof Error ? err.message : err);
    }
  }

  // ── F2: Weekly rendition close (Sunday 23:00 Chile = Monday 02:00/03:00 UTC) ──
  // El manejo de tenant vive dentro de cerrarRendicionesSemana (cross-tenant).
  @Cron('0 3 * * 1')
  async weeklyRenditionClose(): Promise<void> {
    this.logger.log('[Cron] Weekly rendition close running...');
    try {
      await this.rendicionesService.cerrarRendicionesSemana();
      this.logger.log('[Cron] Weekly rendition close done');
    } catch (err) {
      this.logger.error('[Cron] Weekly rendition close error:', err instanceof Error ? err.message : err);
    }
  }
}
