import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';
import { QUEUE_MIND_PROACTIVE } from '../queue/queue.module';
import { RendicionesService } from '../rendiciones/rendiciones.service';
import { OperatorNotifierService } from '../whatsapp/operator-notifier.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsappOutputService } from '../whatsapp/whatsapp-output.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { runWithTenant, runAsSystem } from '../../common/tenant/tenant-context';

// Brief: F5 hourly mini-reports use Haiku (cheap), not Opus
const F5_CRON_MODEL     = 'claude-haiku-4-5-20251001';
const HAIKU_INPUT_PRICE = 0.00000080;
const HAIKU_OUTPUT_PRICE = 0.00000400;

// Brief: sales-invoice reminder — days without billing before alert
const BILLING_ALERT_DAYS = 7;

// ── Convocatoria (C3/C4) — recordatorios de no-respuesta ──────────────────────
// FLAG (timing de negocio, ajustable): horas mínimas que deben pasar sin respuesta
//   —desde el último envío/reenvío— antes de mandar el próximo recordatorio.
//   El cron corre cada hora; con 24h cada promotor recibe a lo sumo 1 recordatorio
//   por día. Total de recordatorios extra = CONVOCATORIA_MAX_REENVIOS (2), es decir
//   día original + 2 reintentos ≈ ventana de 3 días antes de escalar al operador.
const CONVOCATORIA_RECORDATORIO_HORAS = 24;
// Máximo de recordatorios automáticos antes de escalar la tarea al OPERATOR.
// Coincide con el invariante de negocio "2 recordatorios" (reenvio_count 1 y 2).
const CONVOCATORIA_MAX_REENVIOS = 2;

@Injectable()
export class CronService {
  private readonly logger    = new Logger(CronService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUE_MIND_PROACTIVE) private readonly mindQueue: Queue,
    private readonly rendicionesService: RendicionesService,
    private readonly notifier: OperatorNotifierService,
    private readonly wa: WhatsAppService,
    private readonly waOutput: WhatsappOutputService,
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
               (client_id, tipo, titulo, descripcion, accion_propuesta, severidad, estado, created_at)
             VALUES ($1, 'alerta_facturacion', $2, $3, $4::jsonb, 'alta', 'abierta', NOW())
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
               (client_id, tipo, titulo, descripcion, accion_propuesta, severidad, estado, created_at)
             VALUES ($1, 'alerta_devolucion', $2, $3, $4::jsonb, 'alta', 'abierta', NOW())
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

  // ── F5: Recordatorio D+1 de reporte al cliente — daily at 09:00 ──
  // Process map §F5: el reporte al cliente se envía al día siguiente (D+1) de la
  // activación. Este cron busca activaciones de AYER que no estén cerradas y cuyo
  // reporte AÚN no fue enviado, y le recuerda al operador que tiene que enviarlo.
  // Tenant/RLS: lista cross-tenant con runAsSystem; el chequeo "ya enviado" y la
  // notificación corren en la tx del tenant con runWithTenant (mismo patrón que
  // hourlyF5Reports / returnReminder24h).
  @Cron('0 9 * * *')
  async dailyF5ReportReminder(): Promise<void> {
    this.logger.log('[Cron] F5 D+1 report reminder running...');
    try {
      const activaciones = await runAsSystem(() =>
        this.ds.query(
          `SELECT id, client_id, activation_date
             FROM activations
            WHERE activation_date = CURRENT_DATE - INTERVAL '1 day'
              AND estado_f5 IS DISTINCT FROM 'cerrada'`,
        ),
      ).catch(() => []);

      let recordatorios = 0;
      for (const act of activaciones) {
        await runWithTenant(this.ds, act.client_id, async () => {
          // ¿Ya se envió el reporte al cliente de esta activación? Si sí → skip.
          const [enviado] = await this.ds.query(
            `SELECT 1 FROM reportes_cliente
              WHERE activacion_id=$1 AND client_id=$2 AND estado='enviado'
              LIMIT 1`,
            [act.id, act.client_id],
          ).catch(() => []);
          if (enviado) return;

          const fecha = act.activation_date
            ? new Date(act.activation_date).toLocaleDateString('es-CL')
            : 'ayer';
          const msg =
            `📋 Recordatorio: la activación ${act.id} del ${fecha} necesita que ` +
            `envíes el reporte al cliente (D+1).`;
          // dedupKey por día → el operador recibe el aviso una sola vez por jornada.
          const day = new Date().toISOString().slice(0, 10);
          await this.notifier
            .notificar(act.client_id, msg, `f5-d1-reminder:${act.id}:${day}`)
            .catch(() => {});
          recordatorios++;
        }).catch((err) =>
          this.logger.error(
            `[CronF5D1] cliente ${act.client_id}:`,
            err instanceof Error ? err.message : err,
          ),
        );
      }

      this.logger.log(`[Cron] F5 D+1 reminder done — ${recordatorios} recordatorio(s) enviados`);
    } catch (err) {
      this.logger.error('[Cron] F5 D+1 reminder error:', err instanceof Error ? err.message : err);
    }
  }

  // ── F4 (C3/C4): Recordatorios de convocatoria sin respuesta — cada hora ──────
  // C3: convocatorias en 'enviada' sin respuesta (respuesta_at IS NULL) reciben
  //     hasta CONVOCATORIA_MAX_REENVIOS recordatorios por WhatsApp, uno cada
  //     CONVOCATORIA_RECORDATORIO_HORAS. reenvio_count lleva la cuenta (idempotencia:
  //     el UPDATE condicionado a reenvio_count evita mandar dos veces el mismo nivel).
  // C4: al agotar los recordatorios (reenvio_count = MAX) y seguir sin respuesta, se
  //     crea UNA tarea al OPERATOR ('user') vía mind_propuesta + WhatsApp. escalada_at
  //     es el guard de idempotencia (se setea una sola vez).
  // Tenant/RLS: lista cross-tenant con runAsSystem; cada fila se procesa en la tx de
  //     su tenant con runWithTenant (mismo patrón que dailyF5ReportReminder).
  @Cron('0 * * * *')
  async convocatoriaRecordatorios(): Promise<void> {
    this.logger.log('[Cron] Convocatoria recordatorios running...');
    try {
      // Candidatas: enviadas, sin respuesta, con recordatorios pendientes O ya
      // agotados pero sin escalar. El filtro fino (¿reenviar? ¿escalar?) se hace
      // por fila para poder usar el timing y los guards de forma precisa.
      const pendientes = await runAsSystem(() =>
        this.ds.query(
          `SELECT c.id, c.client_id, c.proyecto_id, c.persona_id, c.dia,
                  c.local_nombre, c.local_direccion, c.reenvio_count,
                  c.escalada_at,
                  COALESCE(c.mensaje_enviado_at, c.updated_at) AS ultimo_envio,
                  EXTRACT(EPOCH FROM (NOW() - COALESCE(c.mensaje_enviado_at, c.updated_at)))/3600 AS horas_desde_envio,
                  pr.name  AS proyecto_nombre,
                  p.name   AS persona_nombre,
                  p.phone  AS persona_phone
             FROM convocatorias c
             LEFT JOIN projects  pr ON pr.id = c.proyecto_id
             LEFT JOIN promoters p  ON p.id  = c.persona_id
            WHERE c.estado = 'enviada'
              AND c.respuesta_at IS NULL`,
        ),
      ).catch(() => []);

      let reenviados = 0;
      let escalados  = 0;

      for (const c of pendientes) {
        await runWithTenant(this.ds, c.client_id, async () => {
          const horas   = Number(c.horas_desde_envio) || 0;
          const reenvio = Number(c.reenvio_count) || 0;

          // ── C3: reenviar recordatorio si toca ──────────────────────────────
          if (reenvio < CONVOCATORIA_MAX_REENVIOS && horas >= CONVOCATORIA_RECORDATORIO_HORAS) {
            if (!c.persona_phone) {
              this.logger.warn(`[CronConv] conv=${c.id} sin teléfono — no se puede recordar`);
              return;
            }
            // Idempotencia: sólo reenvía si reenvio_count no cambió (otra corrida
            // concurrente no lo incrementó primero). El bump del contador es atómico.
            const bump = await this.ds.query(
              `UPDATE convocatorias
                  SET reenvio_count = reenvio_count + 1,
                      mensaje_enviado_at = NOW(),
                      updated_at = NOW()
                WHERE id = $1 AND client_id = $2
                  AND estado = 'enviada' AND respuesta_at IS NULL
                  AND reenvio_count = $3
                RETURNING reenvio_count`,
              [c.id, c.client_id, reenvio],
            ).catch(() => []);
            if (!bump.length) return; // ya lo tomó otra corrida

            const nivel = bump[0].reenvio_count;
            const ok = await this.wa.enviarConvocatoria({
              telefono:       c.persona_phone,
              nombrePromotor: c.persona_nombre ?? '',
              proyecto:       c.proyecto_nombre ?? 'la activación',
              fecha:          c.dia ? new Date(c.dia).toLocaleDateString('es-CL') : 'por confirmar',
              local:          c.local_nombre    ?? 'Por confirmar',
              direccion:      c.local_direccion ?? 'Por confirmar',
            }).catch(() => false);
            reenviados++;
            this.logger.log(`[CronConv] Recordatorio ${nivel}/${CONVOCATORIA_MAX_REENVIOS} conv=${c.id} ok=${ok}`);
            return;
          }

          // ── C4: escalar al OPERATOR tras agotar recordatorios ──────────────
          if (reenvio >= CONVOCATORIA_MAX_REENVIOS && !c.escalada_at
              && horas >= CONVOCATORIA_RECORDATORIO_HORAS) {
            // Guard de idempotencia: setea escalada_at sólo si aún es NULL.
            const marca = await this.ds.query(
              `UPDATE convocatorias
                  SET escalada_at = NOW(), updated_at = NOW()
                WHERE id = $1 AND client_id = $2
                  AND estado = 'enviada' AND respuesta_at IS NULL
                  AND escalada_at IS NULL
                RETURNING id`,
              [c.id, c.client_id],
            ).catch(() => []);
            if (!marca.length) return; // ya escalada por otra corrida

            const fecha = c.dia ? new Date(c.dia).toLocaleDateString('es-CL') : 'la fecha asignada';

            // Tarea persistente en el dashboard de Mind. Se alinea al esquema REAL de
            // mind_propuestas (migración 022): tipo VARCHAR(20), severidad (no 'prioridad'),
            // accion_propuesta JSONB (no 'datos_soporte'), estado='abierta' (lo que filtra
            // el dashboard en mind-propuestas.service). tipo='conv_sin_resp' (≤20 chars).
            await this.ds.query(
              `INSERT INTO mind_propuestas
                 (client_id, tipo, titulo, descripcion, accion_propuesta, severidad, estado, created_at)
               VALUES ($1, 'conv_sin_resp', $2, $3, $4::jsonb, 'alta', 'abierta', NOW())`,
              [
                c.client_id,
                `Convocatoria sin respuesta: ${c.persona_nombre ?? 'promotor'} — "${c.proyecto_nombre ?? 'proyecto'}"`,
                `${c.persona_nombre ?? 'El promotor'} no respondió tras ${CONVOCATORIA_MAX_REENVIOS} ` +
                  `recordatorios para el turno del ${fecha}. Contactalo o asigná un reemplazo.`,
                JSON.stringify({
                  convocatoria_id: c.id,
                  project_id:      c.proyecto_id,
                  persona_id:      c.persona_id,
                  dia:             c.dia,
                  reenvios:        reenvio,
                }),
              ],
            ).catch((err: any) => this.logger.warn(`[CronConv] mind_propuesta insert conv=${c.id}: ${err?.message}`));

            // Aviso directo al OPERATOR ('user') por WhatsApp (idempotente por conv).
            const msg =
              `📵 Convocatoria "${c.proyecto_nombre ?? 'proyecto'}": ${c.persona_nombre ?? 'un promotor'} ` +
              `no respondió tras ${CONVOCATORIA_MAX_REENVIOS} recordatorios (turno del ${fecha}). ` +
              `Requiere seguimiento manual o reemplazo.`;
            const operators = await this.getOperatorPhones(c.client_id);
            for (const op of operators) {
              await this.waOutput.sendTextOnce(op.phone, msg, `conv-sin-resp:${c.id}:${op.phone}`).catch(() => {});
            }
            escalados++;
            this.logger.warn(`[CronConv] Escalado a operador conv=${c.id} (${operators.length} operador/es 'user')`);
          }
        }).catch((err) =>
          this.logger.error(
            `[CronConv] cliente ${c.client_id}:`,
            err instanceof Error ? err.message : err,
          ),
        );
      }

      this.logger.log(`[Cron] Convocatoria recordatorios done — ${reenviados} reenviado(s), ${escalados} escalado(s)`);
    } catch (err) {
      this.logger.error('[Cron] Convocatoria recordatorios error:', err instanceof Error ? err.message : err);
    }
  }

  /** Teléfonos de los OPERATOR (rol 'user') del tenant con phone registrado. */
  private async getOperatorPhones(clientId: string): Promise<{ phone: string }[]> {
    return this.ds.query(
      `SELECT phone FROM users
        WHERE client_id=$1 AND role='${UserRole.OPERATOR}' AND phone IS NOT NULL`,
      [clientId],
    ).catch(() => []);
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

  // ── T11: Weekly pending-payment reminder — Monday 12:00 UTC (~09:00 Chile) ──
  // Digest al manager de rendiciones APROBADAS que siguen sin pagar. El manejo de
  // tenant vive dentro de notificarPendientesDePago (cross-tenant, mismo patrón).
  @Cron('0 12 * * 1')
  async weeklyPaymentReminder(): Promise<void> {
    this.logger.log('[Cron] Weekly pending-payment reminder running...');
    try {
      await this.rendicionesService.notificarPendientesDePago();
      this.logger.log('[Cron] Weekly pending-payment reminder done');
    } catch (err) {
      this.logger.error('[Cron] Weekly pending-payment reminder error:', err instanceof Error ? err.message : err);
    }
  }
}
