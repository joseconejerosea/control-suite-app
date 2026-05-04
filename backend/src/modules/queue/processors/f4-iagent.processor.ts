import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
@Processor('f4-iagent')
export class F4IAgentProcessor extends WorkerHost {
  private readonly logger = new Logger(F4IAgentProcessor.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    super();
  }

  async process(job: Job<{
    client_id: string;
    project_id: string;  // proyecto ya creado en estado 'pending_ia'
    doc_key: string;
    ocr_text?: string;
  }>): Promise<void> {
    const { client_id, project_id, doc_key, ocr_text } = job.data;
    this.logger.log(`[F4iAgent] Procesando brief para proyecto ${project_id}`);

    try {
      // Actualizar estado
      await this.ds.query(
        `UPDATE projects SET config=jsonb_set(COALESCE(config,'{}'), '{ia_status}', '"processing"') WHERE id=$1`,
        [project_id],
      );

      // Obtener texto OCR del documento (si no viene en el job, intentar leerlo del evento)
      const texto = ocr_text ?? await this.obtenerTextoBrief(project_id, client_id);

      // Llamar Claude para extraer datos del proyecto
      const extracted = await this.extraerDatosConIA(texto, client_id);

      // Actualizar proyecto con los datos extraídos
      await this.ds.query(
        `UPDATE projects SET
           name = COALESCE($2, name),
           description = $3,
           start_date = $4,
           end_date = $5,
           budget = $6,
           config = jsonb_build_object(
             'ia_status', 'pending_human_approval',
             'ia_extracted', $7::jsonb,
             'cliente_final', $8,
             'costo_estimado', $9,
             'margen_proyectado', $10,
             'doc_key', $11
           ),
           updated_at = NOW()
         WHERE id=$1 AND client_id=$12`,
        [
          project_id,
          extracted.nombre_proyecto,
          extracted.brief,
          extracted.fecha_inicio,
          extracted.fecha_fin,
          extracted.presupuesto_otorgado,
          JSON.stringify(extracted),
          extracted.cliente_final,
          extracted.costo_estimado,
          extracted.margen_proyectado,
          doc_key,
          client_id,
        ],
      );

      // Crear locales si los extrajo
      if ((extracted as any).locales?.length) {
        for (const local of (extracted as any).locales) {
          await this.ds.query(
            `INSERT INTO locations (client_id, name, address)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [client_id, local.nombre, local.direccion],
          ).catch(() => {});
        }
      }

      this.logger.log(`[F4iAgent] Proyecto ${project_id} listo para aprobación humana`);

    } catch (err: any) {
      this.logger.error(`[F4iAgent] Error procesando brief:`, err.message);
      await this.ds.query(
        `UPDATE projects SET config=jsonb_set(COALESCE(config,'{}'), '{ia_status}', '"failed"') WHERE id=$1`,
        [project_id],
      );
    }
  }

  private async obtenerTextoBrief(projectId: string, clientId: string): Promise<string> {
    // Intentar obtener desde evento crudo asociado
    const rows = await this.ds.query(
      `SELECT ec.payload FROM eventos_crudos ec
       WHERE ec.client_id=$1 ORDER BY ec.created_at DESC LIMIT 1`,
      [clientId],
    );
    return rows[0]?.payload?.ocr_text ?? 'Documento de propuesta sin texto OCR disponible.';
  }

  private async extraerDatosConIA(texto: string, clientId: string): Promise<Record<string, unknown>> {
    const start = Date.now();

    // Obtener proyectos históricos para estimación de costos
    const historico = await this.ds.query(
      `SELECT name, budget, start_date, end_date FROM projects
       WHERE client_id=$1 AND status IN ('paused','archived') ORDER BY created_at DESC LIMIT 5`,
      [clientId],
    );

    const prompt = `Analiza este documento de propuesta/brief para una agencia BTL y extrae los datos del proyecto.

DOCUMENTO:
${texto.slice(0, 50_000)}

PROYECTOS HISTÓRICOS DEL CLIENTE (para estimación de costos):
${JSON.stringify(historico)}

Responde ÚNICAMENTE con JSON válido con esta estructura exacta:
{
  "nombre_proyecto": "nombre del proyecto",
  "cliente_final": "nombre del cliente final (empresa que paga)",
  "cliente_final_rut": "RUT si aparece o null",
  "fecha_inicio": "YYYY-MM-DD o null",
  "fecha_fin": "YYYY-MM-DD o null",
  "presupuesto_otorgado": numero_en_pesos_o_null,
  "brief": "resumen ejecutivo en 2-3 párrafos",
  "locales": [{"nombre": "nombre PDV", "direccion": "dirección"}],
  "perfil_personas": [{"rol": "promotora", "cantidad": 3, "skills": []}],
  "hitos": ["hito 1", "hito 2"],
  "costo_estimado": numero_estimado_o_null,
  "margen_proyectado": numero_porcentaje_o_null,
  "notas_ia": "observaciones del modelo"
}`;

    const response = await this.anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const duration = Date.now() - start;
    await this.ds.query(
      `INSERT INTO ai_costs_log (client_id, model, duration_ms, perfil_origen)
       VALUES ($1,'claude-opus-4-5',$2,'f4-iagent')`,
      [clientId, duration],
    ).catch(() => {});

    const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
    try {
      const clean = text.replace(/```json\n?|```/g, '').trim();
      return JSON.parse(clean);
    } catch {
      return {
        nombre_proyecto: 'Proyecto sin nombre',
        cliente_final: 'Por definir',
        brief: texto.slice(0, 500),
        notas_ia: 'Error parseando respuesta de IA',
      };
    }
  }
}

