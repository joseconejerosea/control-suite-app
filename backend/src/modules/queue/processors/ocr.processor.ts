import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../metrics/metrics.service';
import { StorageService } from '../../../common/storage/storage.service';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { isFinalAttempt } from '../../../common/queue/is-final-attempt';
import { SAFE_MESSAGES } from '../../../common/exceptions';

const QUEUE_F1_CLASSIFY = 'classify';
const F1_OCR_MAX_CHARS  = 50000;

// Resultado del paso de visión: sólo el texto OCR (la clasificación
// documento/material/evidencia se removió en Phase 2 — el tipo lo decide el
// remitente por menú, no la visión IA). Se conserva el `usage` para el costeo.
type VisionResult = {
  text: string;
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
  ) {
    super();
  }

  async process(job: Job<{ evento_crudo_id: string; client_id: string; canal: string }>): Promise<void> {
    return this.runJob(job);
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

      // T10 · Dedup por contenido — guardá el sha256 del archivo (si aún no está) para
      // que el persist processor pueda detectar un reenvío byte-idéntico de la MISMA
      // boleta. Los paths manual/email setean doc_sha256 al ingresar; el de WhatsApp NO,
      // así que acá lo backfilleamos para todos por igual (WHERE doc_sha256 IS NULL = no-op
      // para manual/email). Best-effort: un fallo acá no debe voltear el OCR.
      const docSha256 = crypto
        .createHash('sha256')
        .update(Buffer.from(base64, 'base64'))
        .digest('hex');
      await this.dataSource.query(
        `UPDATE eventos_crudos SET doc_sha256=$1 WHERE id=$2 AND doc_sha256 IS NULL`,
        [docSha256, evento_crudo_id],
      ).catch((e: any) => this.logger.warn(`[F1OCR] no se pudo guardar doc_sha256: ${e.message}`));

      const startTime = Date.now();
      const ocrResult = await this.extractTextWithClaude(base64, mimeType);
      const ocrText   = ocrResult.text;
      const duration  = Date.now() - startTime;
      const durationSec = duration / 1000;

      // Record OCR duration metric
      this.metrics.f1OcrDuration.observe({ engine: 'claude-vision' }, durationSec);

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

    // Phase 2 (T3): la visión ya NO clasifica el tipo (documento/material/evidencia).
    // El tipo lo decide el remitente por menú y sólo las facturas llegan a este OCR.
    // El prompt pide únicamente una lectura fiel del texto (PDF e imagen por igual).
    const promptText =
      'Extract ALL text from this document. Output only the raw text, preserving structure. No explanations.';

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

    return this.parseVisionResult(raw, usage);
  }

  /**
   * Extrae el texto OCR de la respuesta de visión. Phase 2 (T3): la respuesta es
   * texto plano (ya no un JSON de triage), así que sólo normalizamos el string y
   * conservamos el `usage` para el costeo de IA.
   */
  private parseVisionResult(raw: string, usage: VisionResult['usage']): VisionResult {
    return { text: typeof raw === 'string' ? raw : '', usage };
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