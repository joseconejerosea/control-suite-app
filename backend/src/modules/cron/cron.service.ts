import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Cron('0 * * * *')
  async hourlyF5Reports() {
    this.logger.log('[Cron] Hourly F5 reports running...');
    try {
      const activaciones = await this.ds.query(
        `SELECT id, client_id FROM activations WHERE estado_f5='en_vivo' AND status='in_progress'`
      ).catch(() => []);

      for (const act of activaciones) {
        const [ch, inc] = await Promise.all([
          this.ds.query(`SELECT COUNT(*) as c FROM checkins WHERE activacion_id=$1`, [act.id]).catch(() => [{ c: 0 }]),
          this.ds.query(`SELECT COUNT(*) as c FROM incidencias WHERE activacion_id=$1 AND estado='abierta'`, [act.id]).catch(() => [{ c: 0 }]),
        ]);

        const resp = await this.anthropic.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 150,
          messages: [{ role: 'user', content: `Reporte BTL. Check-ins: ${ch[0]?.c}. Incidencias abiertas: ${inc[0]?.c}. Mini-reporte en 2 lineas.` }],
        });

        const texto = (resp.content[0] as any).text;
        const costo = (resp.usage.input_tokens * 0.000003) + (resp.usage.output_tokens * 0.000015);

        await this.ds.query(
          `INSERT INTO ai_costs_log (client_id, flow, model, input_tokens, output_tokens, costo_usd, descripcion) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [act.client_id, 'f5_cron', 'claude-opus-4-5', resp.usage.input_tokens, resp.usage.output_tokens, costo, `Hourly ${act.id}`]
        ).catch(() => {});

        await this.ds.query(
          `INSERT INTO reportes_avance (client_id, activacion_id, momento, observacion, persona_id) VALUES ($1,$2,'hourly_ai',$3,'00000000-0000-0000-0000-000000000000') ON CONFLICT DO NOTHING`,
          [act.client_id, act.id, `[AI Hourly] ${texto}`]
        ).catch(() => {});
      }
      this.logger.log(`[Cron] Done — ${activaciones.length} activations`);
    } catch (err: any) {
      this.logger.error('[Cron] Error:', err.message);
    }
  }

  @Cron('0 */4 * * *')
  async proactiveMind() {
    this.logger.log('[Cron] Proactive Mind running...');
  }
}
