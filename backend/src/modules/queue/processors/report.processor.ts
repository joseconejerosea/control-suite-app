import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';
import * as PDFDocument from 'pdfkit';
import { runWithTenant } from '../../../common/tenant/tenant-context';
import { OperatorNotifierService } from '../../whatsapp/operator-notifier.service';

const REPORT_MODEL = 'claude-haiku-4-5-20251001';

@Injectable()
@Processor('report-gen')
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportProcessor.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly notifier: OperatorNotifierService,
  ) {
    super();
  }

  async process(job: Job<{
    client_id: string;
    activation_id: string;
    user_id: string;
  }>): Promise<void> {
    const { client_id, activation_id } = job.data;
    this.logger.log(`[Report] Generating report for activation ${activation_id}`);
    // RLS: correr bajo app.current_tenant. Sin esto, con RLS activo (039/041) las
    // lecturas volvían vacías y el INSERT fallaba en silencio (.catch tragado).
    await runWithTenant(this.ds, client_id, () => this.generarBorrador(job.data));
  }

  /**
   * F5 Fase 2: genera el reporte con IA y lo guarda como BORRADOR (estado='borrador',
   * SIN aprobado_at). La IA propone; el humano dispone vía /aprobar. El INSERT ya no
   * traga errores: si falla, el job reintenta.
   */
  private async generarBorrador(
    data: { client_id: string; activation_id: string; user_id: string },
  ): Promise<void> {
    const { client_id, activation_id } = data;
    try {
      const [activation] = await this.ds.query(
        `SELECT a.*, p.name as project_name, c.nombre as client_name
         FROM activations a
         LEFT JOIN projects p ON p.id = a.project_id
         JOIN clients c ON c.id = a.client_id
         WHERE a.id = $1 AND a.client_id = $2`,
        [activation_id, client_id],
      );
      if (!activation) {
        this.logger.warn(`[Report] Activation ${activation_id} not found`);
        return;
      }

      const [checkins, incidencias, eventos, reportesAvance] = await Promise.all([
        this.ds.query(`SELECT * FROM checkins WHERE activacion_id=$1 ORDER BY ts`, [activation_id]).catch(() => []),
        this.ds.query(`SELECT * FROM incidencias WHERE activacion_id=$1 ORDER BY created_at`, [activation_id]).catch(() => []),
        this.ds.query(`SELECT * FROM activation_events WHERE activation_id=$1 ORDER BY created_at`, [activation_id]).catch(() => []),
        this.ds.query(`SELECT * FROM reportes_avance WHERE activacion_id=$1 ORDER BY ts`, [activation_id]).catch(() => []),
      ]);

      const prompt = `Genera un reporte ejecutivo de activación BTL.

ACTIVACIÓN: ${activation.project_name ?? 'Sin proyecto'}
FECHA: ${activation.activation_date ?? 'N/A'}
UBICACIÓN: ${JSON.stringify(activation.location ?? {})}

CHECK-INS (${checkins.length}):
${checkins.map((c: any) => `- ${c.ts}: persona ${c.persona_id?.slice(0, 8)}`).join('\n') || 'Ninguno'}

INCIDENCIAS (${incidencias.length}):
${incidencias.map((i: any) => `- [${i.severidad}] ${i.descripcion} (${i.estado})`).join('\n') || 'Ninguna'}

EVENTOS DE UBICACIÓN (${eventos.length}):
${eventos.map((e: any) => `- ${e.event_type}: ${e.location_status ?? 'N/A'}`).join('\n') || 'Ninguno'}

REPORTES DE AVANCE (${reportesAvance.length}):
${reportesAvance.map((r: any) => `- ${r.momento}: ${r.observacion ?? r.contenido ?? ''}`).join('\n') || 'Ninguno'}

Responde en JSON con esta estructura:
{
  "resumen_ejecutivo": "2-3 párrafos",
  "asistencia": { "total_checkins": N, "verificados": N, "desfasados": N },
  "incidencias_resumen": "resumen de incidencias",
  "timeline": ["evento1", "evento2"],
  "conclusion": "párrafo final",
  "calificacion": "excelente|buena|regular|deficiente"
}`;

      const response = await this.anthropic.messages.create({
        model: REPORT_MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
      let reportData: Record<string, unknown>;
      try {
        reportData = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
      } catch {
        reportData = { resumen_ejecutivo: text, calificacion: 'regular' };
      }

      const pdfBuffer = await this.generatePdf(activation, reportData, checkins, incidencias);

      const [reporte] = await this.ds.query(
        `INSERT INTO reportes_cliente
           (client_id, activacion_id, version_interna_jsonb, version_cliente_jsonb, estado)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, 'borrador')
         RETURNING id`,
        [
          client_id, activation_id,
          JSON.stringify(reportData),
          JSON.stringify({ ...reportData, pdf_generated: true }),
        ],
      );

      this.logger.log(`[Report] Borrador generado para activación ${activation_id} (${pdfBuffer.length} bytes PDF)`);

      // F5 Fase 3: process map — "avisa cuando el borrador está listo".
      const msg = `📝 Borrador de reporte listo para revisar (activación ${activation_id}). Aprobalo antes de enviar al cliente.`;
      await this.notifier.notificar(client_id, msg, `f5-borrador:${reporte?.id}`).catch(() => {});

    } catch (err: any) {
      this.logger.error(`[Report] Error: ${err.message}`);
      throw err;
    }
  }

  private async generatePdf(
    activation: any,
    reportData: any,
    checkins: any[],
    incidencias: any[],
  ): Promise<Buffer> {
    return new Promise((resolve) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.fontSize(20).text('Reporte de Activación', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#666')
        .text(`Control Suite BTL — ${new Date().toLocaleDateString('es-CL')}`, { align: 'center' });
      doc.moveDown(1);

      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ddd');
      doc.moveDown(0.5);

      doc.fontSize(12).fillColor('#000')
        .text(`Proyecto: ${activation.project_name ?? 'N/A'}`)
        .text(`Fecha: ${activation.activation_date ?? 'N/A'}`)
        .text(`Estado: ${activation.status ?? 'N/A'}`)
        .text(`Calificación: ${reportData.calificacion ?? 'N/A'}`);
      doc.moveDown(1);

      doc.fontSize(14).text('Resumen Ejecutivo', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).text(reportData.resumen_ejecutivo ?? 'Sin resumen disponible.');
      doc.moveDown(1);

      doc.fontSize(14).text('Asistencia', { underline: true });
      doc.moveDown(0.3);
      const asist = reportData.asistencia ?? {};
      doc.fontSize(10)
        .text(`Check-ins totales: ${asist.total_checkins ?? checkins.length}`)
        .text(`Ubicación verificada: ${asist.verificados ?? 0}`)
        .text(`Ubicación desfasada: ${asist.desfasados ?? 0}`);
      doc.moveDown(1);

      if (incidencias.length) {
        doc.fontSize(14).text('Incidencias', { underline: true });
        doc.moveDown(0.3);
        for (const inc of incidencias) {
          doc.fontSize(10).text(`• [${inc.severidad}] ${inc.descripcion} — ${inc.estado}`, { indent: 10 });
        }
        doc.moveDown(1);
      }

      if (reportData.conclusion) {
        doc.fontSize(14).text('Conclusión', { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(10).text(reportData.conclusion);
      }

      doc.moveDown(2);
      doc.fontSize(8).fillColor('#999')
        .text('Generado automáticamente por Control Suite BTL', { align: 'center' });

      doc.end();
    });
  }
}
