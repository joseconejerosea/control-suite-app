import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { MindPropuestasService } from '../../mind/mind-propuestas.service';

/**
 * Implementa los 10 triggers del Perfil Proactivo (spec §08):
 * 1. Presupuesto al 95%+
 * 2. Personas sin rendir +5 días
 * 3. Margen de proyecto < 25%
 * 4. Factura cliente vencida > 5 días
 * 5. Stock insuficiente para activación próxima
 * 6. Persona no responde convocatoria en 5h (F4)
 * 7. Patrón anómalo de gastos (persona +180% vs histórico)
 * 8. Posible duplicado en F1
 * 9. Costo IA del cliente subiendo
 * 10. Cliente sin actividad 30+ días
 */
@Injectable()
@Processor('mind-proactive')
export class MindProactiveProcessor extends WorkerHost {
  private readonly logger = new Logger(MindProactiveProcessor.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly mindSvc: MindPropuestasService,
  ) {
    super();
  }

  async process(job: Job<{ client_id?: string }>): Promise<void> {
    const { client_id } = job.data;
    const clientes = client_id
      ? [{ id: client_id }]
      : await this.ds.query(`SELECT id FROM clients WHERE status='active'`);

    for (const c of clientes) {
      await this.detectarParaCliente(c.id).catch((err) =>
        this.logger.error(`[MindProactive] Error cliente ${c.id}:`, err.message),
      );
    }
    await this.mindSvc.expirarAntiguas();
  }

  private async detectarParaCliente(clientId: string): Promise<void> {
    await Promise.all([
      this.trigger1_PresupuestoExcedido(clientId),
      this.trigger2_SinRendir(clientId),
      this.trigger3_MargenBorde(clientId),
      this.trigger4_FacturaVencida(clientId),
      this.trigger5_StockInsuficiente(clientId),
      this.trigger7_GastoAnomalo(clientId),
      this.trigger8_DuplicadoF1(clientId),
      this.trigger9_CostoIASubiendo(clientId),
      this.trigger10_SinActividad(clientId),
    ]);
    // Trigger 6 (convocatoria sin respuesta) se maneja en F4 processor directamente
  }

  // ── Trigger 1: Presupuesto al 95%+ ────────────────────────────────────────
  private async trigger1_PresupuestoExcedido(clientId: string): Promise<void> {
    const proyectos = await this.ds.query(
      `SELECT p.id, p.name, p.budget::numeric as budget,
              COALESCE(SUM(r.monto_total::numeric),0) as gasto
       FROM projects p
       LEFT JOIN rendiciones r ON r.project_id=p.id AND r.estado IN ('aprobada','pagada')
       WHERE p.client_id=$1 AND p.status='active' AND p.budget IS NOT NULL
       GROUP BY p.id
       HAVING COALESCE(SUM(r.monto_total::numeric),0) / NULLIF(p.budget::numeric,0) >= 0.90`,
      [clientId],
    );
    for (const p of proyectos) {
      const pct = Math.round((p.gasto / p.budget) * 100);
      if (await this.propuestaYaExiste(clientId, `presupuesto_${p.id}`)) continue;
      const restante = (p.budget - p.gasto).toLocaleString('es-CL');
      await this.mindSvc.crear({
        clientId, tipo: 'proactivo', perfilOrigen: `presupuesto_${p.id}`,
        titulo: `${p.name} al ${pct}% del presupuesto`,
        descripcion: `Quedan solo $${restante} disponibles. ${pct >= 100 ? '¡Ya está sobrepasado!' : 'Al ritmo actual podría excederse.'}`,
        severidad: pct >= 100 ? 'critica' : pct >= 97 ? 'alta' : 'media',
        accionPropuesta: { tipo: 'reasignar_presupuesto', proyecto_id: p.id, pct },
        expiresInHours: 48,
      });
    }
  }

  // ── Trigger 2: Personas sin rendir +5 días ────────────────────────────────
  private async trigger2_SinRendir(clientId: string): Promise<void> {
    const res = await this.ds.query(
      `SELECT COUNT(DISTINCT persona_id) as n,
              COALESCE(SUM(monto_total::numeric),0) as monto
       FROM rendiciones
       WHERE client_id=$1 AND estado='enviada'
         AND created_at < NOW() - INTERVAL '5 days'`,
      [clientId],
    );
    if (parseInt(res[0].n) === 0) return;
    if (await this.propuestaYaExiste(clientId, 'sin_rendir')) return;
    await this.mindSvc.crear({
      clientId, tipo: 'proactivo', perfilOrigen: 'sin_rendir',
      titulo: `${res[0].n} persona(s) con rendiciones sin revisar hace +5 días`,
      descripcion: `Hay $${parseFloat(res[0].monto).toLocaleString('es-CL')} en rendiciones enviadas pendientes de aprobación.`,
      severidad: 'media',
      accionPropuesta: { tipo: 'enviar_recordatorio', target: 'admins' },
      expiresInHours: 24,
    });
  }

  // ── Trigger 3: Margen < 25% ───────────────────────────────────────────────
  private async trigger3_MargenBorde(clientId: string): Promise<void> {
    const proyectos = await this.ds.query(
      `SELECT p.id, p.name, p.budget::numeric as budget,
              COALESCE(SUM(i.amount::numeric),0) as gasto_facturado
       FROM projects p
       LEFT JOIN invoices i ON i.project_id=p.id AND i.category='expense'
       WHERE p.client_id=$1 AND p.status='active' AND p.budget::numeric > 0
       GROUP BY p.id
       HAVING (p.budget::numeric - COALESCE(SUM(i.amount::numeric),0)) / p.budget::numeric < 0.25`,
      [clientId],
    );
    for (const p of proyectos) {
      const margen = Math.round(((p.budget - p.gasto_facturado) / p.budget) * 100);
      if (await this.propuestaYaExiste(clientId, `margen_${p.id}`)) continue;
      await this.mindSvc.crear({
        clientId, tipo: 'proactivo', perfilOrigen: `margen_${p.id}`,
        titulo: `Margen de "${p.name}" al borde (${margen}%)`,
        descripcion: `Solo queda ${margen}% de presupuesto. Revisar costos antes de comprometer más.`,
        severidad: margen < 10 ? 'alta' : 'media',
        accionPropuesta: { tipo: 'analisis_costos', proyecto_id: p.id },
        expiresInHours: 72,
      });
    }
  }

  // ── Trigger 4: Factura cliente vencida >5 días ────────────────────────────
  private async trigger4_FacturaVencida(clientId: string): Promise<void> {
    const facturas = await this.ds.query(
      `SELECT id, vendor_name, amount, invoice_date
       FROM invoices
       WHERE client_id=$1 AND category='sale' AND status='pending'
         AND invoice_date < NOW() - INTERVAL '5 days'
       ORDER BY amount::numeric DESC LIMIT 5`,
      [clientId],
    );
    if (!facturas.length) return;
    if (await this.propuestaYaExiste(clientId, 'facturas_vencidas')) return;
    const montoTotal = facturas.reduce((s: number, f: any) => s + parseFloat(f.amount), 0);
    await this.mindSvc.crear({
      clientId, tipo: 'proactivo', perfilOrigen: 'facturas_vencidas',
      titulo: `${facturas.length} factura(s) de cliente vencida(s) — $${montoTotal.toLocaleString('es-CL')} por cobrar`,
      descripcion: `Llevan más de 5 días sin pago. La más grande: ${facturas[0].vendor_name} por $${parseFloat(facturas[0].amount).toLocaleString('es-CL')}.`,
      severidad: montoTotal > 1_000_000 ? 'alta' : 'media',
      accionPropuesta: { tipo: 'redactar_correo', factura_ids: facturas.map((f: any) => f.id) },
      expiresInHours: 48,
    });
  }

  // ── Trigger 5: Stock insuficiente ─────────────────────────────────────────
  private async trigger5_StockInsuficiente(clientId: string): Promise<void> {
    const alertas = await this.ds.query(
      `SELECT s.nombre, p.name as proyecto, p.start_date,
              COALESCE(SUM(inv.cantidad),0) as disponible
       FROM skus s CROSS JOIN projects p
       LEFT JOIN inventario inv ON inv.sku_id=s.id
       WHERE s.client_id=$1 AND p.client_id=$1 AND s.active=true
         AND p.status='active' AND p.start_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
       GROUP BY s.id, s.nombre, p.id, p.name, p.start_date
       HAVING COALESCE(SUM(inv.cantidad),0) < 5`,
      [clientId],
    );
    if (!alertas.length || await this.propuestaYaExiste(clientId, 'stock_bajo')) return;
    await this.mindSvc.crear({
      clientId, tipo: 'proactivo', perfilOrigen: 'stock_bajo',
      titulo: `Stock bajo para activaciones próximas (${alertas.length} SKUs)`,
      descripcion: `${alertas.length} SKUs con stock < 5 unidades para proyectos en los próximos 7 días.`,
      severidad: 'alta',
      accionPropuesta: { tipo: 'marcar_stock_revision', alertas },
      expiresInHours: 24,
    });
  }

  // ── Trigger 7: Patrón anómalo de gastos ───────────────────────────────────
  private async trigger7_GastoAnomalo(clientId: string): Promise<void> {
    const anomalias = await this.ds.query(
      `WITH historico AS (
         SELECT persona_id, AVG(monto_total::numeric) as avg_hist, STDDEV(monto_total::numeric) as std_hist
         FROM rendiciones WHERE client_id=$1 AND created_at < NOW() - INTERVAL '7 days'
         GROUP BY persona_id
       ),
       ultima AS (
         SELECT persona_id, monto_total::numeric as ultimo
         FROM rendiciones WHERE client_id=$1
         AND periodo = (SELECT MAX(periodo) FROM rendiciones WHERE client_id=$1)
       )
       SELECT u.persona_id, h.avg_hist, u.ultimo
       FROM ultima u JOIN historico h ON h.persona_id=u.persona_id
       WHERE u.ultimo > h.avg_hist * 1.8 AND h.avg_hist > 0`,
      [clientId],
    );
    if (!anomalias.length || await this.propuestaYaExiste(clientId, 'gasto_anomalo')) return;
    await this.mindSvc.crear({
      clientId, tipo: 'proactivo', perfilOrigen: 'gasto_anomalo',
      titulo: `Patrón anómalo de gastos detectado — ${anomalias.length} persona(s)`,
      descripcion: `Hay personas con gastos muy por encima de su histórico esta semana. Puede ser un proyecto grande o un error.`,
      severidad: 'media',
      accionPropuesta: { tipo: 'revisar_rendiciones', persona_ids: anomalias.map((a: any) => a.persona_id) },
      expiresInHours: 48,
    });
  }

  // ── Trigger 8: Posible duplicado en F1 ────────────────────────────────────
  private async trigger8_DuplicadoF1(clientId: string): Promise<void> {
    const duplicados = await this.ds.query(
      `SELECT vendor_name, amount, invoice_date, COUNT(*) as n
       FROM invoices WHERE client_id=$1 AND status='pending'
         AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY vendor_name, amount, invoice_date
       HAVING COUNT(*) > 1`,
      [clientId],
    );
    if (!duplicados.length || await this.propuestaYaExiste(clientId, 'duplicados_f1')) return;
    await this.mindSvc.crear({
      clientId, tipo: 'proactivo', perfilOrigen: 'duplicados_f1',
      titulo: `Posibles facturas duplicadas en F1 (${duplicados.length} grupo(s))`,
      descripcion: `Se detectaron facturas con mismo proveedor, monto y fecha. Revisar antes de aprobar.`,
      severidad: 'media',
      accionPropuesta: { tipo: 'revisar_duplicados', grupos: duplicados },
      expiresInHours: 72,
    });
  }

  // ── Trigger 9: Costo IA subiendo ──────────────────────────────────────────
  private async trigger9_CostoIASubiendo(clientId: string): Promise<void> {
    const costos = await this.ds.query(
      `SELECT
         SUM(CASE WHEN ts > NOW() - INTERVAL '7 days' THEN COALESCE(cost_usd::numeric,0) ELSE 0 END) as esta_semana,
         SUM(CASE WHEN ts BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days' THEN COALESCE(cost_usd::numeric,0) ELSE 0 END) as semana_pasada
       FROM ai_costs_log WHERE client_id=$1`,
      [clientId],
    );
    if (!costos[0].semana_pasada || costos[0].semana_pasada <= 0) return;
    const variacion = costos[0].esta_semana / costos[0].semana_pasada;
    if (variacion < 1.5 || await this.propuestaYaExiste(clientId, 'costo_ia')) return;
    await this.mindSvc.crear({
      clientId, tipo: 'proactivo', perfilOrigen: 'costo_ia',
      titulo: `Uso de IA ${Math.round((variacion - 1) * 100)}% mayor vs semana pasada`,
      descripcion: `Esta semana: $${parseFloat(costos[0].esta_semana).toFixed(2)} USD vs $${parseFloat(costos[0].semana_pasada).toFixed(2)} USD. Revisar si el volumen justifica el costo.`,
      severidad: 'baja',
      accionPropuesta: { tipo: 'revisar_uso_ia' },
      expiresInHours: 168,
    });
  }

  // ── Trigger 10: Sin actividad 30+ días ────────────────────────────────────
  private async trigger10_SinActividad(clientId: string): Promise<void> {
    const actividad = await this.ds.query(
      `SELECT COUNT(*) as total FROM eventos_crudos
       WHERE client_id=$1 AND created_at > NOW() - INTERVAL '30 days'`,
      [clientId],
    );
    if (parseInt(actividad[0].total) > 0) return;
    if (await this.propuestaYaExiste(clientId, 'sin_actividad')) return;
    await this.mindSvc.crear({
      clientId, tipo: 'proactivo', perfilOrigen: 'sin_actividad',
      titulo: 'Sin actividad en canales hace +30 días',
      descripcion: 'No se han recibido documentos o eventos en ningún canal. Posible riesgo de churn.',
      severidad: 'baja',
      accionPropuesta: { tipo: 'revisar_canales' },
      expiresInHours: 168,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  private async propuestaYaExiste(clientId: string, perfilOrigen: string): Promise<boolean> {
    const res = await this.ds.query(
      `SELECT id FROM mind_propuestas
       WHERE client_id=$1 AND perfil_origen=$2 AND estado='abierta'
         AND (expira_at IS NULL OR expira_at > NOW()) LIMIT 1`,
      [clientId, perfilOrigen],
    );
    return res.length > 0;
  }
}
