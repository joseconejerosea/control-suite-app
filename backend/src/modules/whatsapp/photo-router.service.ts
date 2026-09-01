import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { WhatsAppService } from './whatsapp.service';
import { MaterialIntakeService } from './material-intake.service';
import { EvidenceIntakeService } from './evidence-intake.service';
import { MetricsService } from '../metrics/metrics.service';
import { runWithTenant } from '../../common/tenant/tenant-context';

const QUEUE_OCR = 'ocr';

/**
 * A3 · Ruteo post-tipo de una foto ya subida a storage. Extraído del controller
 * (antes `routeByType`) a un servicio inyectable para que lo compartan:
 *   - el webhook (usuario elige el tipo por menú), y
 *   - el PhotoTriageProcessor (la visión IA auto-detecta el tipo con alta confianza).
 *
 * La lógica de persistencia del evento/flow NO se duplica: vive acá una sola vez.
 */
@Injectable()
export class PhotoRouterService {
  private readonly logger = new Logger(PhotoRouterService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue(QUEUE_OCR) private readonly ocrQueue: Queue,
    private readonly materialIntake: MaterialIntakeService,
    private readonly evidenceIntake: EvidenceIntakeService,
    private readonly wa: WhatsAppService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Rutea una foto ya subida a storage según el tipo (elegido por el remitente en el
   * menú o auto-detectado por la visión IA). Invoca el mismo destino que corría el triage
   * post-OCR — sólo cambia QUIÉN decide el tipo. El `flow` se fija por tipo para que
   * material/evidencia NO caigan en la cola F1 "Documentos por revisar" (que filtra
   * flow='F1'); el intake luego reescribe el flow (F3_INTAKE / F5_EVID) al registrar, o
   * queda en F3/F5 si no hay activación:
   *   factura   → flow:'F1' — OCR-read: el OcrProcessor sólo lee el texto, ya no triagea.
   *   material  → flow:'F3' — materialIntake.start.
   *   evidencia → flow:'F5' — evidenceIntake.start.
   *
   * A-002 · Si `existingEventId` viene seteado (rama media-first: la foto ya se persistió
   * con flow=null al llegar y quedó buffereada), NO inserta un evento nuevo: sólo ACTUALIZA
   * el flow de esa fila. Si no viene (rama tipo-primero: la foto llegó después de elegir el
   * tipo), persiste una fila fresca como hasta ahora. Así cada foto media-first tiene una
   * fila eventos_crudos durable desde su llegada, sin blobs huérfanos si se abandona.
   *
   * A3 · `suggestedLabel` (opcional) es el nombre corto del material sugerido por la visión
   * IA cuando el ruteo lo dispara el triage automático; se pasa a materialIntake.start para
   * pre-cargar el nombre. En el path del menú (usuario) no se pasa.
   *
   * A3 · `suppressFacturaAck` (opcional) omite el ack "Recibí tu foto..." de la rama factura.
   * Lo pasa SOLO el auto-ruteo del triage, porque el controller ya mandó su propio ack al
   * buffear la foto; sin esto se manda un doble mensaje casi idéntico. En el path del menú
   * (usuario) no se pasa → el ack se mantiene.
   */
  async route(
    from: string,
    clientId: string,
    canalId: string | null,
    messageId: string,
    type: 'factura' | 'material' | 'evidencia',
    media: { storagePath: string; mimeType: string; caption: string },
    existingEventId?: string,
    suggestedLabel?: string | null,
    suppressFacturaAck?: boolean,
  ): Promise<void> {
    const flow = type === 'factura' ? 'F1' : type === 'material' ? 'F3' : 'F5';
    let eventId: string;
    if (existingEventId) {
      // La foto ya se persistió con flow=null al llegar (A-002). CLAIM ATÓMICO: dos caminos
      // pueden rutear el MISMO evento buffereado (el tap del menú y el auto-ruteo del triage),
      // ambos con flow=null. El UPDATE condicionado (flow IS NULL AND status <> 'superseded')
      // + RETURNING deja que sólo el PRIMERO gane: fija el flow y sigue; el SEGUNDO ve 0 filas
      // → no-op temprano (sin OCR, sin intake, sin mensaje). El `status <> 'superseded'` cubre
      // además el evento reemplazado por una segunda foto (el re-buffer lo marca superseded sin
      // tocar el flow). RLS: el webhook es @Public → runWithTenant para que el UPDATE vea la fila.
      const claimed = await runWithTenant(this.ds, clientId, () =>
        this.ds.query(
          `UPDATE eventos_crudos SET flow=$2, updated_at=NOW()
             WHERE id=$1 AND flow IS NULL AND status <> 'superseded'
           RETURNING id`,
          [existingEventId, flow],
        ),
      );
      if (!claimed || claimed.length === 0) {
        this.logger.warn(`[PhotoRouter] evento ${existingEventId} ya ruteado o superseded → no-op`);
        return;
      }
      eventId = existingEventId;
    } else {
      eventId = await this.persistEvent({
        clientId, canalId, messageId, from, type: 'image', flow,
        payload: {
          storage_path: media.storagePath,
          mime_type: media.mimeType,
          caption: media.caption,
        },
      });
    }

    if (type === 'factura') {
      // Routing observability: one f1_events_total per routed photo (restores the signal
      // the removed OCR-vision triage used to emit; 'factura_intake' is new to the menu router).
      this.metrics.f1EventsTotal.inc({ client_id: clientId, canal: 'whatsapp', status: 'factura_intake' });
      await this.ocrQueue.add('ocr', {
        evento_crudo_id: eventId, client_id: clientId, canal: 'whatsapp',
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
      // El auto-ruteo del triage omite este ack (suppressFacturaAck): el controller ya mandó
      // "Recibí tu foto, la reviso…" al buffear. En el path del menú (usuario) sí se manda.
      if (!suppressFacturaAck) {
        await this.wa.sendText(from, '📎 Recibí tu foto, la estoy revisando...');
      }
      return;
    }

    if (type === 'material') {
      this.metrics.f1EventsTotal.inc({ client_id: clientId, canal: 'whatsapp', status: 'material_intake' });
      await this.materialIntake.start({
        eventoCrudoId: eventId, phoneNumber: from, clientId, storagePath: media.storagePath, suggestedLabel,
      });
      return;
    }

    // evidencia
    this.metrics.f1EventsTotal.inc({ client_id: clientId, canal: 'whatsapp', status: 'evidence_intake' });
    await this.evidenceIntake.start({
      eventoCrudoId: eventId, phoneNumber: from, clientId, storagePath: media.storagePath,
    });
  }

  /**
   * Persiste un evento crudo (rama tipo-primero, sin `existingEventId`). Mismo INSERT que
   * el del controller — RLS: el webhook es @Public, así que el UPDATE del path A-002 se
   * envuelve en runWithTenant; este INSERT lo hacía el controller sin tenant explícito
   * (la fila es nueva y el flow ya la excluye/incluye de las colas por sí solo).
   */
  private async persistEvent(opts: {
    clientId: string | null;
    canalId: string | null;
    messageId: string;
    from: string;
    type: string;
    flow: string | null;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const result = await this.ds.query(
      `INSERT INTO eventos_crudos
         (client_id, canal_entrada_id, source, idempotency_key,
          flow, payload, status, processed, attempts,
          created_at, updated_at)
       VALUES
         ($1, $2, 'whatsapp', $3,
          $4, $5::jsonb, 'queued', false, 0,
          NOW(), NOW())
       RETURNING id`,
      [
        opts.clientId,
        opts.canalId,
        opts.messageId,
        opts.flow,
        JSON.stringify({ ...opts.payload, from: opts.from, type: opts.type }),
      ],
    );

    return result[0]?.id;
  }
}
