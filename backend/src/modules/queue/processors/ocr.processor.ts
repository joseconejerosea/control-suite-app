import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../metrics/metrics.service';
import { StorageService } from '../../../common/storage/storage.service';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { MaterialIntakeService } from '../../whatsapp/material-intake.service';
import { runWithWaFrom } from '../../whatsapp/whatsapp-send-context';
import { resolveWaFrom } from '../../whatsapp/resolve-wa-from';
import { isFinalAttempt } from '../../../common/queue/is-final-attempt';
import { SAFE_MESSAGES } from '../../../common/exceptions';

const QUEUE_F1_CLASSIFY = 'classify';
const F1_OCR_MAX_CHARS  = 50000;

// Resultado del paso de visión: además del texto (para documentos), un triage
// documento/material/ambiguo (para imágenes de WhatsApp). Ver buildVisionResult.
type VisionResult = {
  text: string;
  kind: 'document' | 'material' | 'ambiguous';
  label: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
};

@Processor('ocr')
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(QUEUE_F1_CLASSIFY) private readonly classifyQueue: Queue,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly storage: StorageService,
    private readonly wa: WhatsAppService,
    private readonly materialIntake: MaterialIntakeService,
  ) {
    super();
  }

  async process(job: Job<{ evento_crudo_id: string; client_id: string; canal: string }>): Promise<void> {
    // Los workers no heredan el ALS de número saliente del webhook: sin esto, los
    // envíos (material, fallos) salen del número GLOBAL y Meta los rechaza (JD-B-003).
    const waFrom = await resolveWaFrom(this.dataSource, job.data.evento_crudo_id, job.data.client_id);
    await runWithWaFrom(waFrom, () => this.runJob(job));
  }

  private async runJob(job: Job<{ evento_crudo_id: string; client_id: string; canal: string }>): Promise<void> {
    const { evento_crudo_id, client_id, canal } = job.data;
    this.logger.log(`[F1OCR] Processing evento: ${evento_crudo_id}`);

    await this.dataSource.query(
      `UPDATE eventos_crudos SET processing_status_new='processing'::processing_status_f1, status='processing' WHERE id=$1`,
      [evento_crudo_id],
    );

    // Hoisted para que el catch pueda notificar al remitente (el phone vive en el payload).
    let eventPayload: any = null;
    try {
      const rows = await this.dataSource.query(
        `SELECT payload, doc_mime_type FROM eventos_crudos WHERE id=$1`,
        [evento_crudo_id],
      );
      if (!rows.length) throw new Error('Evento not found');

      const payload  = rows[0].payload;
      eventPayload = payload;
      // doc_mime_type (columna) puede venir null en eventos de WhatsApp; el mime
      // real viaja en el payload.
      const mimeType = rows[0].doc_mime_type ?? payload.mime_type;

      // El archivo puede venir como base64 inline (rama de desambiguación) o,
      // lo normal, como storage_path (handleImage/handleDocument lo suben a
      // Supabase Storage). Si no hay base64, lo bajamos del storage.
      let base64 = payload.file_base64;
      if (!base64 && payload.storage_path) {
        try {
          const buffer = await this.storage.download(payload.storage_path);
          base64 = buffer.toString('base64');
        } catch (err: any) {
          await this.setStatus(evento_crudo_id, 'failed_ocr', `Storage download failed: ${err.message}`);
          this.metrics.f1EventsTotal.inc({ client_id, canal, status: 'failed_ocr' });
          await this.notifyFailure(eventPayload, canal);
          return;
        }
      }

      if (!base64) {
        await this.setStatus(evento_crudo_id, 'failed_ocr', 'No file data in payload');
        this.metrics.f1EventsTotal.inc({ client_id, canal, status: 'failed_ocr' });
        await this.notifyFailure(eventPayload, canal);
        return;
      }

      const startTime = Date.now();
      const ocrResult = await this.extractTextWithClaude(base64, mimeType);
      const ocrText   = ocrResult.text;
      const duration  = Date.now() - startTime;
      const durationSec = duration / 1000;

      // Record OCR duration metric
      this.metrics.f1OcrDuration.observe({ engine: 'claude-vision' }, durationSec);

      // ── Triage documento vs material (F3) ────────────────────────────────
      // Solo para IMÁGENES de WhatsApp (un PDF nunca es material). El material no
      // tiene texto útil, así que se decide ANTES del check de "texto vacío".
      // Invariante: ante ambigüedad se PREGUNTA, no se asume.
      const isImage = !!mimeType && mimeType !== 'application/pdf';
      const phone = eventPayload?.from ?? null;
      if (isImage && canal === 'whatsapp' && phone) {
        if (ocrResult.kind === 'material') {
          await this.materialIntake.start({
            eventoCrudoId: evento_crudo_id, phoneNumber: phone, clientId: client_id,
            storagePath: eventPayload?.storage_path, suggestedLabel: ocrResult.label,
          });
          this.metrics.f1EventsTotal.inc({ client_id, canal, status: 'material_intake' });
          return;
        }
        if (ocrResult.kind === 'ambiguous') {
          // Guardar el texto: si el usuario responde "documento", classify lo reanuda.
          await this.dataSource.query(
            `UPDATE eventos_crudos SET ocr_text=$1, ocr_engine='claude-vision', ocr_attempted_at=NOW(), status='awaiting_material' WHERE id=$2`,
            [(ocrText ?? '').slice(0, F1_OCR_MAX_CHARS), evento_crudo_id],
          );
          await this.materialIntake.askKind({
            eventoCrudoId: evento_crudo_id, phoneNumber: phone, clientId: client_id,
            storagePath: eventPayload?.storage_path, suggestedLabel: ocrResult.label,
          });
          this.metrics.f1EventsTotal.inc({ client_id, canal, status: 'ambiguous_kind' });
          return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      if (!ocrText || ocrText.length < 20) {
        await this.setStatus(evento_crudo_id, 'failed_ocr', 'OCR returned empty or too short text');
        this.metrics.f1EventsTotal.inc({ client_id, canal, status: 'failed_ocr' });
        await this.notifyFailure(eventPayload, canal);
        return;
      }

      const truncated = ocrText.slice(0, F1_OCR_MAX_CHARS);

      await this.dataSource.query(
        `UPDATE eventos_crudos SET
          ocr_text=$1, ocr_engine='claude-vision',
          ocr_duration_ms=$2, ocr_attempted_at=NOW(), status='ocr_done'
        WHERE id=$3`,
        [truncated, duration, evento_crudo_id],
      );

      this.logger.log(`[F1OCR] Done for ${evento_crudo_id} (${duration}ms, ${truncated.length} chars)`);
      this.metrics.f1EventsTotal.inc({ client_id, canal, status: 'ocr_done' });

      // Registrar el costo de IA del OCR. Antes se descartaba el `usage` de
      // Claude → la Auditoría AI no reflejaba el gasto del flujo F1.
      if (ocrResult.usage) {
        const inTok  = ocrResult.usage.input_tokens ?? 0;
        const outTok = ocrResult.usage.output_tokens ?? 0;
        // Claude Haiku 4.5 (aprox): ~$1/M input, ~$5/M output.
        const costUsd = inTok * 0.000001 + outTok * 0.000005;
        await this.dataSource.query(
          `INSERT INTO ai_costs_log (client_id, flow, model, input_tokens, output_tokens, cost_usd, description)
           VALUES ($1, 'F1', 'claude-haiku-4-5', $2, $3, $4, $5)`,
          [client_id, inTok, outTok, costUsd, `OCR F1 evento=${evento_crudo_id}`],
        ).catch((e: any) => this.logger.warn(`[F1OCR] No se pudo registrar costo IA: ${e.message}`));
      }

      await this.classifyQueue.add('classify', { evento_crudo_id, client_id, canal }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });

    } catch (err: any) {
      this.logger.error(`[F1OCR] Error: ${err.message}`);
      await this.setStatus(evento_crudo_id, 'failed_ocr', err.message);
      this.metrics.f1EventsTotal.inc({ client_id, canal, status: 'failed_ocr' });
      // Solo en el último intento: evita mandar un error por cada reintento de BullMQ.
      if (isFinalAttempt(job)) await this.notifyFailure(eventPayload, canal);
      throw err;
    }
  }

  /**
   * Aviso de fallo por WhatsApp al remitente. Silencioso y best-effort: nunca
   * debe alterar el flujo de fallo ya persistido. El teléfono viaja en el payload.
   */
  private async notifyFailure(payload: any, canal: string): Promise<void> {
    if (canal !== 'whatsapp') return;
    const phone = typeof payload === 'object' ? (payload?.from ?? payload?.phone ?? null) : null;
    if (phone) await this.wa.avisarFalloProcesamiento(phone).catch(() => {});
  }

  private async extractTextWithClaude(base64: string, mimeType: string): Promise<VisionResult> {
    // Los bloques `image` de Claude solo aceptan imágenes (JPG/PNG/WEBP/GIF). Un PDF
    // debe ir como bloque `document`; sin esto, las facturas/boletas en PDF fallaban
    // el OCR. Se rutea por mime: PDF → document, resto → image.
    const isPdf = mimeType === 'application/pdf';
    const fileBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mimeType,          data: base64 } };

    // PDF → solo extracción de texto (un PDF nunca es material POP): prompt y salida
    // intactos respecto al comportamiento previo. Imagen → triage + texto en un JSON,
    // así una sola llamada de visión decide documento/material/ambiguo sin costo extra.
    const promptText = isPdf
      ? 'Extract ALL text from this document. Output only the raw text, preserving structure. No explanations.'
      : `You are triaging a photo sent to a field-operations bot. Classify it as:
- "document": an invoice, receipt, boleta, contract, form or any paper/text business document.
- "material": a physical POP / inventory item (furniture, stand, banner, branded object, equipment) — NOT a paper document.
- "ambiguous": genuinely unclear.
ALWAYS extract any readable text present in the image into "text", regardless of the kind. Only leave "text" empty if there is truly no readable text in the image.
Respond with ONLY this JSON, no markdown:
{"kind":"document|material|ambiguous","label":"<short name of the item if material, else null>","text":"<ALL readable text in the image; empty only if there is truly no text>"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: promptText }] }],
      }),
    });
    if (!response.ok) throw new Error(`Claude OCR API error: ${response.status}`);
    const data = await response.json() as any;
    const raw = data?.content?.[0]?.text ?? '';
    const usage = data?.usage ?? null;

    if (isPdf) {
      return { text: raw, kind: 'document', label: null, usage };
    }
    return this.parseVisionTriage(raw, usage);
  }

  /**
   * Parsea la respuesta JSON del triage de imágenes. Fail-safe: ante JSON inválido
   * o kind desconocido, cae a 'document' con el texto crudo — así una imagen jamás
   * se pierde y, en la duda, sigue el pipeline F1 existente (que a su vez puede pedir aclaración).
   */
  private parseVisionTriage(raw: string, usage: VisionResult['usage']): VisionResult {
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const kind = ['document', 'material', 'ambiguous'].includes(parsed?.kind) ? parsed.kind : 'document';
      return {
        text: typeof parsed?.text === 'string' ? parsed.text : '',
        kind,
        label: parsed?.label && typeof parsed.label === 'string' ? parsed.label : null,
        usage,
      };
    } catch {
      return { text: raw, kind: 'document', label: null, usage };
    }
  }

  /**
   * Persists a failure status. The raw technical cause (`rawDetail`) is written to the
   * application log for debugging but NEVER stored in `error_message`: that column is
   * returned by the API and rendered in the admin UI, so it must only carry a short,
   * safe, neutral-Spanish category message.
   */
  private async setStatus(id: string, status: string, rawDetail: string): Promise<void> {
    this.logger.error(`[F1OCR] setStatus ${status} [evento=${id}]: ${rawDetail}`);
    await this.dataSource.query(
      `UPDATE eventos_crudos SET processing_status_new=$1::processing_status_f1, status=$1::text, error_message=$2 WHERE id=$3`,
      [status, SAFE_MESSAGES.INTEGRATION_FAILURE, id],
    );
  }
}