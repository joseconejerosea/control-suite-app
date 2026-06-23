import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';

const CLAUDE_MODEL = 'claude-opus-4-5';

export interface Insight {
  tipo: 'tendencia' | 'comparacion' | 'anomalia' | 'oportunidad' | 'riesgo';
  titulo: string;
  descripcion: string;
  metricas: Record<string, number>;
  recomendacion?: string;
}

@Injectable()
export class MindAnalistaService {
  private readonly logger = new Logger(MindAnalistaService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ─── Trigger: cierre de mes / on-demand ─────────────────────────────────
  async generarInsightsMensuales(clientId: string): Promise<Insight[]> {
    const datos = await this.recopilarDatos(clientId);
    return this.analizarConIA(clientId, datos, 'cierre_mes');
  }

  // ─── Trigger: pregunta del usuario ("cómo estamos") ──────────────────────
  async analizarComoEstamos(clientId: string): Promise<Insight[]> {
    const datos = await this.recopilarDatos(clientId);
    return this.analizarConIA(clientId, datos, 'on_demand');
  }

  // ─── Trigger: cierre de proyecto ─────────────────────────────────────────
  async analizarCierreProyecto(clientId: string, projectId: string): Promise<Insight[]> {
    const datos = await this.recopilarDatosProyecto(clientId, projectId);
    return this.analizarConIA(clientId, datos, 'cierre_proyecto');
  }

  // ─── Detección de anomalías automática (llamar desde cron) ───────────────
  async detectarAnomalias(clientId: string): Promise<void> {
    const insights = await this.detectarPatrones(clientId);
    for (const insight of insights) {
      await this.ds.query(
        `INSERT INTO mind_propuestas
           (client_id, tipo, perfil_origen, titulo, descripcion, severidad, accion_propuesta)
         VALUES ($1,'analista','analista_anomalia',$2,$3,$4,$5)`,
        [
          clientId,
          insight.titulo,
          insight.descripcion,
          insight.tipo === 'riesgo' ? 'alta' : insight.tipo === 'anomalia' ? 'media' : 'baja',
          JSON.stringify({ tipo: 'revisar_insight', insight }),
        ],
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  private async recopilarDatos(clientId: string): Promise<Record<string, unknown>> {
    const [gastosMes, proyectos, rendicionesResumen, merma] = await Promise.all([
      // Gastos últimos 3 meses por categoría
      this.ds.query(
        `SELECT DATE_TRUNC('month', invoice_date::date) as mes,
                category, SUM(amount::numeric) as total
         FROM invoices WHERE client_id=$1
           AND invoice_date >= NOW() - INTERVAL '3 months'
         GROUP BY 1, 2 ORDER BY 1`,
        [clientId],
      ),
      // Proyectos con margen
      this.ds.query(
        `SELECT p.id, p.name, p.budget::numeric,
                COALESCE(SUM(i.amount::numeric),0) as gasto,
                p.budget::numeric - COALESCE(SUM(i.amount::numeric),0) as margen
         FROM projects p
         LEFT JOIN invoices i ON i.project_id=p.id
         WHERE p.client_id=$1 AND p.status='active'
         GROUP BY p.id`,
        [clientId],
      ),
      // Rendiciones por persona (últimos 30 días)
      this.ds.query(
        `SELECT persona_id, COUNT(*) as rendiciones, AVG(monto_total::numeric) as promedio_historico,
                MAX(monto_total::numeric) as maximo
         FROM rendiciones WHERE client_id=$1 AND created_at >= NOW() - INTERVAL '30 days'
         GROUP BY persona_id`,
        [clientId],
      ),
      // Merma últimos 30 días
      this.ds.query(
        `SELECT s.nombre, SUM(m.cantidad) as merma_total
         FROM movimientos_pop m JOIN skus s ON s.id=m.sku_id
         WHERE m.client_id=$1 AND m.tipo='merma' AND m.created_at >= NOW() - INTERVAL '30 days'
         GROUP BY s.nombre`,
        [clientId],
      ),
    ]);

    return { gastosMes, proyectos, rendicionesResumen, merma };
  }

  private async recopilarDatosProyecto(clientId: string, projectId: string): Promise<Record<string, unknown>> {
    // Verify ownership FIRST and short-circuit — otherwise a foreign projectId
    // would still aggregate another tenant's invoices/rendiciones/movimientos.
    const proyecto = await this.ds.query(
      `SELECT * FROM projects WHERE id=$1 AND client_id=$2`,
      [projectId, clientId],
    );
    if (!proyecto.length) {
      throw new NotFoundException(`Proyecto ${projectId} no encontrado`);
    }

    // Every aggregate is also scoped by client_id (defence in depth).
    const [facturas, rendiciones, movimientos] = await Promise.all([
      this.ds.query(`SELECT SUM(amount::numeric) as total, COUNT(*) as n FROM invoices WHERE project_id=$1 AND client_id=$2`, [projectId, clientId]),
      this.ds.query(`SELECT estado, COUNT(*), SUM(monto_total::numeric) as total FROM rendiciones WHERE project_id=$1 AND client_id=$2 GROUP BY estado`, [projectId, clientId]),
      this.ds.query(`SELECT tipo, SUM(cantidad) as total FROM movimientos_pop WHERE proyecto_destino_id=$1 AND client_id=$2 GROUP BY tipo`, [projectId, clientId]),
    ]);
    return { proyecto: proyecto[0], facturas: facturas[0], rendiciones, movimientos };
  }

  private async detectarPatrones(clientId: string): Promise<Insight[]> {
    const insights: Insight[] = [];

    // Patrón: persona gasta 180%+ vs su histórico
    const anomalias = await this.ds.query(
      `SELECT r.persona_id,
              AVG(r.monto_total::numeric) OVER (PARTITION BY r.persona_id) as historico,
              r.monto_total::numeric as esta_semana
       FROM rendiciones r
       WHERE r.client_id=$1 AND r.periodo = (
         SELECT MAX(periodo) FROM rendiciones WHERE client_id=$1
       )`,
      [clientId],
    );
    for (const a of anomalias) {
      if (a.esta_semana > a.historico * 1.8) {
        insights.push({
          tipo: 'anomalia',
          titulo: `Gasto anómalo detectado esta semana`,
          descripcion: `Una persona rindió ${Math.round((a.esta_semana / a.historico - 1) * 100)}% más vs su promedio histórico. Puede ser un proyecto grande o un error.`,
          metricas: { esta_semana: a.esta_semana, historico: a.historico },
          recomendacion: 'Revisar las boletas de esta rendición específica.',
        });
      }
    }

    return insights;
  }

  private async analizarConIA(
    clientId: string,
    datos: Record<string, unknown>,
    trigger: string,
  ): Promise<Insight[]> {
    const prompt = `Eres un analista financiero de una agencia BTL chilena. Analiza estos datos y genera 2-4 insights accionables.

TRIGGER: ${trigger}
DATOS: ${JSON.stringify(datos, null, 2).slice(0, 8000)}

Responde SOLO con JSON válido en este formato:
[
  {
    "tipo": "tendencia|comparacion|anomalia|oportunidad|riesgo",
    "titulo": "Título corto y directo",
    "descripcion": "Descripción en 1-2 oraciones con números concretos",
    "metricas": { "key": number },
    "recomendacion": "Acción específica a tomar"
  }
]

Reglas:
- Usa pesos chilenos con formato $1.234.567
- Sé directo, sin jerga corporativa
- Solo incluye insights que tengan datos que los respalden`;

    try {
      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = (response.content[0] as Anthropic.TextBlock).text
        .replace(/```json\n?|```/g, '').trim();
      return JSON.parse(text) as Insight[];
    } catch (err: any) {
      this.logger.error('[MindAnalista] Error generando insights:', err.message);
      return [];
    }
  }
}

