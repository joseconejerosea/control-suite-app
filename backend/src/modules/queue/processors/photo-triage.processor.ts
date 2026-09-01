import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { StorageService } from '../../../common/storage/storage.service';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { WhatsAppSessionService } from '../../whatsapp/whatsapp-session.service';
import { WhatsAppActionMenuService } from '../../whatsapp/action-menu.service';
import { PhotoRouterService } from '../../whatsapp/photo-router.service';
import { MetricsService } from '../../metrics/metrics.service';

export const QUEUE_PHOTO_TRIAGE = 'photo-triage';
const PHOTO_TRIAGE_CONFIDENCE_AUTO = 0.85;

type PhotoTriagePayload = {
  evento_crudo_id: string;
  client_id: string;
  canal: string;
  from: string;
  storage_path: string;
  mime_type: string;
  canal_id: string | null;
};

// Resultado de la visión: el tipo de la foto + confianza + (para material) un nombre
// sugerido. `usage` se conserva para el costeo de IA.
type TriageResult = {
  tipo: 'factura' | 'material' | 'evidencia' | 'no_clasificable';
  confidence: number;
  sugerencia: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
};

/**
 * A3 síntoma 1 · Triage de foto por visión IA.
 *
 * Cuando llega una FOTO al bot sin tipo elegido, hoy el webhook la bufferea y encola este
 * job. La visión IA (Claude Haiku) clasifica la foto y, si está MUY confiada del tipo
 * (confidence >= 0.85), auto-rutea salteando el menú "¿Qué es esta foto?". Si duda,
 * cae al menú (red de seguridad OBLIGATORIA: T3 sacó la visión por misclasificación, así
 * que el umbral alto + fallback al menú son lo que la reintroduce de forma segura).
 *
 * NUNCA deja al usuario colgado: cualquier error (descarga/IA/parseo) cae SIEMPRE al menú.
 */
@Processor(QUEUE_PHOTO_TRIAGE)
export class PhotoTriageProcessor extends WorkerHost {
  private readonly logger = new Logger(PhotoTriageProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly wa: WhatsAppService,
    private readonly sessions: WhatsAppSessionService,
    private readonly actionMenu: WhatsAppActionMenuService,
    private readonly photoRouter: PhotoRouterService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<PhotoTriagePayload>): Promise<void> {
    return this.runJob(job);
  }

  private async runJob(job: Job<PhotoTriagePayload>): Promise<void> {
    const { evento_crudo_id, client_id, canal, from, storage_path, mime_type, canal_id } = job.data;
    this.logger.log(`[PhotoTriage] Clasificando foto evento=${evento_crudo_id}`);

    // PDF no aplica a la visión de foto (esto es una imagen). Defensa: si por alguna razón
    // llega un mime PDF, no clasificamos → menú directo.
    if (mime_type === 'application/pdf') {
      this.logger.warn(`[PhotoTriage] mime PDF en triage de foto evento=${evento_crudo_id} → menú`);
      await this.fallbackToMenu(from, client_id, canal);
      return;
    }

    let triage: TriageResult;
    try {
      const buffer = await this.storage.download(storage_path);
      const base64 = buffer.toString('base64');
      triage = await this.classifyPhoto(base64, mime_type);
    } catch (err: any) {
      // Error de descarga/IA/parseo → NUNCA dejar al usuario colgado: menú SIEMPRE.
      this.logger.error(`[PhotoTriage] Error clasificando evento=${evento_crudo_id}: ${err.message}`);
      await this.fallbackToMenu(from, client_id, canal);
      return;
    }

    // Costeo de IA (best-effort, igual que ocr.processor): un fallo acá no debe voltear el triage.
    await this.registrarCostoIA(client_id, evento_crudo_id, triage.usage);

    const tipoRuteable: 'factura' | 'material' | 'evidencia' | null =
      triage.tipo === 'factura' || triage.tipo === 'material' || triage.tipo === 'evidencia'
        ? triage.tipo
        : null;

    if (tipoRuteable && triage.confidence >= PHOTO_TRIAGE_CONFIDENCE_AUTO) {
      // Alta confianza → AUTO-RUTEAR reusando el evento buffereado (A-002). TODO el ruteo va
      // en try/catch: si algo throwea (clearMediaFlow, claim, intake/OCR) NUNCA dejamos al
      // usuario colgado → caemos al menú. Este job es attempts:1 (re-cobra IA), así que el
      // fallback correcto ante fallo es el menú, no reintentar.
      try {
        // ANTES de arrancar el intake, limpiamos el estado awaiting_type para que no quede
        // sesión colgada — el intake/OCR setean su propio estado.
        await this.sessions.clearMediaFlow(from).catch((e: any) =>
          this.logger.warn(`[PhotoTriage] no se pudo limpiar awaiting_type: ${e.message}`),
        );
        const suggestedLabel = tipoRuteable === 'material' ? triage.sugerencia : null;
        await this.photoRouter.route(
          from,
          client_id,
          canal_id,
          // El messageId original no viaja en el payload del job; en la rama existingEventId
          // route() no lo usa (sólo UPDATEa el flow de la fila buffereada), así que pasamos
          // el evento crudo como identificador estable.
          evento_crudo_id,
          tipoRuteable,
          // El caption ya viaja en la fila buffereada; el intake/OCR lo lee de la fila.
          { storagePath: storage_path, mimeType: mime_type, caption: '' },
          evento_crudo_id,
          suggestedLabel,
          // suppressFacturaAck: el controller ya mandó "Recibí tu foto…" al buffear; sin esto
          // la rama factura mandaría un doble ack. Los otros tipos ignoran el flag.
          true,
        );
        // Métrica DESPUÉS de que route() resolvió (si throwea, cuenta como photo_menu en el
        // catch, no doble): observabilidad auto vs menú (T3 sacó la visión por misclasificar;
        // reintroducirla sin métrica sería ciego).
        this.metrics.f1EventsTotal.inc({
          client_id,
          canal,
          status: `photo_auto_${tipoRuteable}`,
        });
        this.logger.log(
          `[PhotoTriage] Auto-ruteado evento=${evento_crudo_id} tipo=${tipoRuteable} conf=${triage.confidence}`,
        );
      } catch (err: any) {
        this.logger.error(
          `[PhotoTriage] Error en auto-ruteo evento=${evento_crudo_id}: ${err.message} → menú`,
        );
        await this.fallbackToMenu(from, client_id, canal);
      }
      return;
    }

    // Baja confianza / no_clasificable → menú (red de seguridad). Dejamos la sesión en
    // awaiting_type (comportamiento actual): el tap del usuario rutea normal.
    this.logger.log(
      `[PhotoTriage] Sin auto-ruteo evento=${evento_crudo_id} tipo=${triage.tipo} conf=${triage.confidence} → menú`,
    );
    await this.fallbackToMenu(from, client_id, canal);
  }

  /**
   * Manda el menú "¿Qué es esta foto?" (best-effort) y emite la métrica photo_menu para la
   * observabilidad auto vs menú (FIX 5). `client_id`/`canal` son opcionales: la defensa PDF
   * temprana no siempre los aporta, pero cuando están los etiquetamos.
   */
  private async fallbackToMenu(from: string, clientId?: string, canal?: string): Promise<void> {
    this.metrics.f1EventsTotal.inc({
      client_id: clientId ?? 'unknown',
      canal: canal ?? 'whatsapp',
      status: 'photo_menu',
    });
    await this.wa.sendText(from, this.actionMenu.buildTypeMenu()).catch((e: any) =>
      this.logger.warn(`[PhotoTriage] no se pudo mandar el menú: ${e.message}`),
    );
  }

  /**
   * Clasifica la foto con Claude visión (mismo patrón que ocr.processor). Devuelve SOLO el
   * tipo, la confianza y (para material) un nombre sugerido. Lanza si la API o el parseo
   * fallan → el caller cae al menú.
   */
  private async classifyPhoto(base64: string, mimeType: string): Promise<TriageResult> {
    const promptText =
      'Eres el clasificador de fotos entrantes de un bot de WhatsApp para agencias BTL.\n' +
      'Clasificá QUÉ es esta foto en uno de estos tipos:\n' +
      '- "factura": una factura, boleta o comprobante de compra (documento con montos, RUT, etc.).\n' +
      '- "material": material POP / merchandising (pieza física de la marca: muebles, gigantografías,\n' +
      '  volumétricos, canastos, displays, etc.).\n' +
      '- "evidencia": foto de la ACTIVIDAD en terreno (gente/anfitrionas/promotores en el evento).\n' +
      '- "no_clasificable": no encaja con claridad en ninguno de los anteriores.\n\n' +
      'Respondé EXCLUSIVAMENTE con un objeto JSON válido, sin markdown ni backticks:\n' +
      '{ "tipo": "factura|material|evidencia|no_clasificable", "confidence": 0.0, "sugerencia": null }\n' +
      'Reglas: confidence entre 0 y 1 (qué tan seguro estás del tipo). "sugerencia" = nombre corto\n' +
      'del material SÓLO si tipo="material" (ej. "Volumétrico"), en cualquier otro caso null.\n' +
      'Ante la duda, bajá la confianza — más vale preguntar que clasificar mal.';

    // Timeout duro del fetch: TODA foto entrante pasa por acá, así que un cuelgue del API
    // de Claude trabaría el worker indefinidamente. AbortController aborta a los 15s → throw
    // → el caller cae al menú (fallback ya existente).
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
                { type: 'text', text: promptText },
              ],
            },
          ],
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    if (!response.ok) throw new Error(`Claude vision API error: ${response.status}`);
    const data = (await response.json()) as any;
    const raw = data?.content?.[0]?.text ?? '';
    const usage = data?.usage ?? null;

    // Sanitizá/parseá el JSON como classify (quita backticks/```json).
    const cleaned = String(raw).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const tipo: TriageResult['tipo'] =
      parsed?.tipo === 'factura' || parsed?.tipo === 'material' || parsed?.tipo === 'evidencia'
        ? parsed.tipo
        : 'no_clasificable';
    const confidence = Number(parsed?.confidence);

    return {
      tipo,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      sugerencia: typeof parsed?.sugerencia === 'string' ? parsed.sugerencia : null,
      usage,
    };
  }

  /**
   * Registra el costo de IA del triage (best-effort). flow='F3' (la foto sin tipo va camino
   * a un intake de material/evidencia o a F1; F3 es el flujo dominante del ruteo por foto).
   */
  private async registrarCostoIA(
    clientId: string,
    eventoCrudoId: string,
    usage: TriageResult['usage'],
  ): Promise<void> {
    if (!usage) return;
    const inTok = usage.input_tokens ?? 0;
    const outTok = usage.output_tokens ?? 0;
    // Claude Haiku 4.5 (aprox): ~$1/M input, ~$5/M output.
    const costUsd = inTok * 0.000001 + outTok * 0.000005;
    await this.dataSource
      .query(
        `INSERT INTO ai_costs_log (client_id, flow, model, input_tokens, output_tokens, cost_usd, description)
         VALUES ($1, 'F3', 'claude-haiku-4-5', $2, $3, $4, $5)`,
        [clientId, inTok, outTok, costUsd, `PhotoTriage evento=${eventoCrudoId}`],
      )
      .catch((e: any) => this.logger.warn(`[PhotoTriage] No se pudo registrar costo IA: ${e.message}`));
  }
}
