import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { runWithTenant } from '../../../common/tenant/tenant-context';

export const QUEUE_PROJECT_INBOX_EXTRACT = 'project-inbox-extract';

interface ProjectInboxExtractJob {
  tenant_id: string;
  inbox_id:  string;
}

/**
 * F4 Tier 2 · Fase 4 (INFRA) — extracción IA sobre uploads de project-inbox.
 *
 * Hoy project_inbox.extracted_data queda NULL y approve() no tiene qué copiar.
 * Este processor lee raw_content, extrae los campos del proyecto con Claude y
 * puebla extracted_data + missing_fields, dejando el item en READY para revisión
 * humana. La estructura del JSON matchea exactamente lo que approve() lee
 * (nombre_proyecto, brief, fecha_inicio, fecha_fin, presupuesto_otorgado, locales).
 *
 * NO crea el proyecto: eso sigue siendo decisión humana (approve()). Sólo prepara
 * los datos para revisión — respeta el gate.
 */
@Processor(QUEUE_PROJECT_INBOX_EXTRACT)
export class ProjectInboxExtractProcessor extends WorkerHost {
  private readonly logger = new Logger(ProjectInboxExtractProcessor.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<ProjectInboxExtractJob>): Promise<void> {
    const { tenant_id } = job.data;
    await runWithTenant(this.ds, tenant_id, () => this.handle(job.data));
  }

  private async handle(data: ProjectInboxExtractJob): Promise<void> {
    const { tenant_id, inbox_id } = data;

    const [item] = await this.ds.query(
      `SELECT raw_content, status FROM project_inbox WHERE id=$1 AND tenant_id=$2`,
      [inbox_id, tenant_id],
    );
    if (!item) {
      this.logger.warn(`[InboxExtract] Item ${inbox_id} no encontrado`);
      return;
    }
    if (item.status !== 'PENDING') {
      this.logger.log(`[InboxExtract] Item ${inbox_id} en ${item.status}, no PENDING — skip`);
      return;
    }

    await this.ds.query(
      `UPDATE project_inbox SET status='PROCESSING' WHERE id=$1 AND tenant_id=$2`,
      [inbox_id, tenant_id],
    );

    try {
      const texto = this.extraerTexto(item.raw_content);
      const extracted = await this.extraerDatosConIA(texto);
      const missing = this.camposFaltantes(extracted);

      await this.ds.query(
        `UPDATE project_inbox
            SET extracted_data=$1::jsonb, missing_fields=$2::jsonb, status='READY'
          WHERE id=$3 AND tenant_id=$4`,
        [JSON.stringify(extracted), JSON.stringify(missing), inbox_id, tenant_id],
      );
      this.logger.log(`[InboxExtract] ${inbox_id} → READY (faltan: ${missing.join(',') || 'nada'})`);
    } catch (err: any) {
      // Volver a PENDING para permitir reintento / carga manual (approve acepta PENDING).
      this.logger.error(`[InboxExtract] Error en ${inbox_id}: ${err.message}`);
      await this.ds.query(
        `UPDATE project_inbox SET status='PENDING' WHERE id=$1 AND tenant_id=$2`,
        [inbox_id, tenant_id],
      ).catch(() => {});
      throw err;
    }
  }

  /** raw_content es JSONB libre del frontend; buscamos el texto del brief donde suela venir. */
  private extraerTexto(rawContent: any): string {
    const rc = typeof rawContent === 'string' ? this.tryParse(rawContent) : rawContent ?? {};
    const candidato =
      rc.ocr_text ?? rc.text ?? rc.content ?? rc.body ?? rc.brief ?? null;
    if (typeof candidato === 'string' && candidato.trim()) return candidato;
    // Fallback: serializar todo el objeto para no perder señal.
    return JSON.stringify(rc);
  }

  private tryParse(s: string): any {
    try { return JSON.parse(s); } catch { return { text: s }; }
  }

  /** Campos críticos que approve() necesita; se reportan para que el operador complete. */
  private camposFaltantes(extracted: Record<string, any>): string[] {
    const faltan: string[] = [];
    if (!extracted.nombre_proyecto) faltan.push('nombre_proyecto');
    if (!extracted.fecha_inicio)    faltan.push('fecha_inicio');
    if (!extracted.fecha_fin)       faltan.push('fecha_fin');
    if (extracted.presupuesto_otorgado == null) faltan.push('presupuesto_otorgado');
    return faltan;
  }

  private async extraerDatosConIA(texto: string): Promise<Record<string, any>> {
    const prompt = `Analizá este documento de propuesta/brief para una agencia BTL y extraé los datos del proyecto.
Tu respuesta debe ser EXCLUSIVAMENTE un JSON válido, sin markdown ni backticks. NUNCA inventes datos: lo que no esté en el documento va como null.

<documento>${texto.slice(0, 45000)}</documento>

Respondé SOLO con este JSON:
{
  "nombre_proyecto": "nombre del proyecto o null",
  "cliente_final": "empresa que paga o null",
  "cliente_final_rut": "RUT o null",
  "fecha_inicio": "YYYY-MM-DD o null",
  "fecha_fin": "YYYY-MM-DD o null",
  "presupuesto_otorgado": numero_en_pesos_o_null,
  "brief": "resumen ejecutivo en 2-3 párrafos o null",
  "locales": [{"nombre": "nombre PDV", "direccion": "dirección"}],
  "perfil_personas": [{"rol": "promotora", "cantidad": 3, "skills": []}],
  "hitos": ["hito 1"],
  "costo_estimado": numero_o_null,
  "margen_proyectado": numero_porcentaje_o_null,
  "notas_ia": "observaciones"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         this.config.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
    const dataResp = await response.json() as any;
    const raw      = dataResp?.content?.[0]?.text ?? '{}';
    const cleaned  = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  }
}
