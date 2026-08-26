import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface WhatsAppSession {
  state: string;
  projects: { id: string; name: string }[];
  base64: string;
  mimeType: string;
  caption: string;
  clientId: string | null;
  canalId: string | null;
  lastProjectId?: string | null;
  updatedAt: string;
  // T3 · Ruteo por menú de la foto entrante.
  // `awaiting_type`: llegó una foto sin flujo activo → se buferea en `bufferedMedia`
  //   y se pregunta el tipo (buildTypeMenu). El texto siguiente elige el tipo y rutea.
  // `awaiting_media`: el remitente eligió el tipo por texto ANTES de mandar la foto →
  //   `pendingType` queda fijado y la próxima foto rutea directo sin re-preguntar.
  pendingType?: 'factura' | 'material' | 'evidencia' | null;
  // A-002 · `eventId` es la fila eventos_crudos persistida AL LLEGAR la foto (flow=null,
  //   fuera de las colas F1/F3/F5). Al elegir el tipo, el ruteo actualiza ese flow en
  //   vez de insertar un evento nuevo → sin blobs huérfanos si la sesión se abandona.
  bufferedMedia?: { storagePath: string; mimeType: string; caption: string; eventId: string } | null;
  // Clarification flow
  //
  // [ADR-11] INVARIANT: Every write assigning `clarification` MUST also set
  // `session.state='awaiting_clarification'` in the SAME set() call, so the
  // handleClarificationResponse gate (clarification.service.ts L97) routes the
  // subsequent reply. Writers that omit state cause the L97 guard to return false.
  clarification?: {
    eventoCrudoId: string;
    type: 'project' | 'data' | 'project_create' | 'project_create_offer';
    attempts: number;
    pendingFields?: string[];
    collected?: Record<string, string>;
    options?: { id: string; label: string }[];
    // [project_create / project_create_offer] Parked eventos to link to the draft.
    pendingEventoIds?: string[];
    // [project_create_offer] The single project the comprobante was auto-filed to.
    autoAssignedProjectId?: string;
    // [project_create_offer] The already-persisted invoice, if any (sub-case 2).
    facturaId?: string;
  } | null;
  // F3 · Intake de material POP por foto (conversación multi-paso).
  // Estado de sesión asociado: state === 'awaiting_material'.
  materialIntake?: {
    eventoCrudoId: string;
    storagePath: string;                 // foto del material → foto_key del SKU y del movimiento
    step: 'nombre' | 'proyecto' | 'destino' | 'bodega' | 'activacion' | 'cantidad' | 'ubicacion' | 'confirmacion';
    attempts: number;
    // A3 · echo-and-confirm for a free-text answer to a LIST step. When a sender
    // answers a list step (proyecto/bodega/activacion) with a name instead of a
    // number and the matcher resolves a unique option, we park the tentative
    // selection here and ask "¿Te referís a *X*?" before applying it. On "sí" we
    // apply optionId for forStep; on "no" we re-show that step's list.
    pendingConfirm?: { forStep: 'proyecto' | 'bodega' | 'activacion'; optionId: string; label: string } | null;
    suggestedLabel?: string | null;      // nombre sugerido por la visión (ambigüedad/ayuda)
    nombre?: string;
    // Ítems del alta. Multi-ítem: el remitente lista "1 Volumétrico / 2 muebles / 6
    // canastos" en un mensaje → un ítem por línea con su cantidad inline. Single-ítem
    // sin número: cantidad=null y se pregunta en el paso 'cantidad'.
    items?: { nombre: string; cantidad: number | null }[];
    proyectoId?: string;
    bodegaId?: string;
    destino?: 'bodega' | 'consumo';           // rama elegida en el paso 'destino'
    activacionId?: string;                     // activación destino cuando destino='consumo'
    activaciones?: { id: string; label: string }[];  // opciones numeradas cacheadas
    cantidad?: number;
    projects?: { id: string; name: string }[];  // opciones cacheadas para parsear el número
    bodegas?: { id: string; name: string }[];
  } | null;
  // Single-global-number · selección de agencia (tenant) para el remitente.
  // Estado asociado: 'awaiting_tenant' (elegir de la lista) o 'awaiting_affiliation_code'
  // (código de una agencia nueva). Se pregunta SIEMPRE (incluso con 1 solo candidato,
  // porque el remitente puede querer operar para una agencia nueva): el mensaje entrante
  // se BUFFEREA acá y al responder se reanuda `pendingMsg` bajo el client_id elegido.
  tenantSelection?: {
    candidates: { clientId: string; clientName: string; rota: boolean }[];  // opciones numeradas cacheadas; rota=true→rotating
    pendingMsg: any;                                          // mensaje WA crudo a reanudar
    canalId: string | null;
    attempts: number;
    // Media pre-capturada al BUFFEREAR (image/audio/video/document). Los media ids de
    // Meta EXPIRAN, así que descargamos los bytes en el momento de bufferear (cuando el
    // tenant aún no se conoce) y los llevamos acá como base64. Al reanudar, los handlers
    // usan estos bytes en vez de volver a pedirle el media a Meta (que ya devolvería 404).
    pendingMedia?: {
      base64: string;
      mimeType: string;
    } | null;
  } | null;
  // F5 · Intake de evidencia de actividad por foto (personas/anfitrionas en el evento).
  // Estado de sesión asociado: state === 'awaiting_evidence'. La evidencia se registra
  // como un checkin (prueba de presencia) de la activación activa del remitente.
  evidenceIntake?: {
    eventoCrudoId: string;
    storagePath: string;                            // foto de la evidencia → foto_key del checkin
    step: 'activacion' | 'observacion' | 'ubicacion';
    attempts: number;
    personaId: string;                              // promotor resuelto (persona_id del checkin)
    activaciones?: { id: string; label: string }[]; // opciones numeradas cacheadas
    activacionId?: string;
    // A4 · La observación se resuelve ANTES del pin de ubicación, así que se parquea
    // acá para que register() la use tras recibir la ubicación (paso obligatorio).
    observacion?: string | null;
  } | null;
}

const PREFIX = 'wa:session:';
const TTL_SECONDS = 4 * 60 * 60; // 4 hours
const DEDUP_PREFIX = 'wa:dedup:';
const DEDUP_TTL_SECONDS = 24 * 60 * 60; // 24 hours

@Injectable()
export class WhatsAppSessionService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppSessionService.name);
  private redis: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    if (url) {
      this.redis = new Redis(url, { maxRetriesPerRequest: null });
    } else {
      this.redis = new Redis({
        host: this.config.get<string>('REDIS_HOST'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        tls: this.config.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
        maxRetriesPerRequest: null,
      });
    }
    this.logger.log('WhatsApp session store initialized (Redis)');
  }

  async get(phoneNumber: string): Promise<WhatsAppSession | null> {
    const data = await this.redis.get(`${PREFIX}${phoneNumber}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(phoneNumber: string, session: WhatsAppSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await this.redis.set(
      `${PREFIX}${phoneNumber}`,
      JSON.stringify(session),
      'EX',
      TTL_SECONDS,
    );
  }

  async delete(phoneNumber: string): Promise<void> {
    await this.redis.del(`${PREFIX}${phoneNumber}`);
  }

  async updateLastProject(phoneNumber: string, projectId: string): Promise<void> {
    const session = await this.get(phoneNumber);
    if (session) {
      session.lastProjectId = projectId;
      await this.set(phoneNumber, session);
    }
  }

  // ── Selección de agencia (single-global-number) ─────────────────────────────

  /**
   * Buffe­rea el mensaje entrante y deja la sesión esperando la elección del remitente.
   * `state='awaiting_tenant'` (elegir de su lista) o `'awaiting_affiliation_code'`
   * (tipear el código de una agencia nueva). INVARIANTE: estado y `tenantSelection` se
   * escriben en el mismo set(), para que el gate de reanudación del webhook enrute la
   * respuesta.
   */
  async setTenantSelection(
    phoneNumber: string,
    selection: NonNullable<WhatsAppSession['tenantSelection']>,
    state: 'awaiting_tenant' | 'awaiting_affiliation_code' = 'awaiting_tenant',
  ): Promise<void> {
    const existing = await this.get(phoneNumber);
    const session: WhatsAppSession = {
      projects: existing?.projects ?? [],
      base64: existing?.base64 ?? '',
      mimeType: existing?.mimeType ?? '',
      caption: existing?.caption ?? '',
      clientId: existing?.clientId ?? null,
      canalId: existing?.canalId ?? selection.canalId,
      lastProjectId: existing?.lastProjectId,
      updatedAt: '',
      ...existing,
      state,
      tenantSelection: selection,
    };
    await this.set(phoneNumber, session);
  }

  /** Limpia la selección pendiente tras reanudar el intake (o al abandonarla). */
  async clearTenantSelection(phoneNumber: string): Promise<void> {
    const session = await this.get(phoneNumber);
    if (!session) return;
    session.tenantSelection = null;
    if (session.state === 'awaiting_tenant' || session.state === 'awaiting_affiliation_code') {
      session.state = '';
    }
    await this.set(phoneNumber, session);
  }

  // ── Menú de acciones (single-global-number) ─────────────────────────────────

  /**
   * Deja la sesión esperando que el remitente elija del menú "¿qué querés hacer?".
   * Persiste el client_id para que la elección + el media que venga después NO
   * vuelvan a preguntar la agencia (state='awaiting_action' es de continuación).
   */
  async setActionMenu(phoneNumber: string, clientId: string): Promise<void> {
    const existing = await this.get(phoneNumber);
    const session: WhatsAppSession = {
      projects: existing?.projects ?? [],
      base64: existing?.base64 ?? '',
      mimeType: existing?.mimeType ?? '',
      caption: existing?.caption ?? '',
      canalId: existing?.canalId ?? null,
      lastProjectId: existing?.lastProjectId,
      updatedAt: '',
      ...existing,
      clientId,
      state: 'awaiting_action',
      // Salir del ruteo por menú de foto: no arrastrar un tipo/foto buffereada stale.
      pendingType: null,
      bufferedMedia: null,
    };
    await this.set(phoneNumber, session);
  }

  /** Sale del estado de menú (al arrancar una acción o abandonarla). */
  async clearActionMenu(phoneNumber: string): Promise<void> {
    const session = await this.get(phoneNumber);
    if (!session) return;
    if (session.state === 'awaiting_action') {
      session.state = '';
      await this.set(phoneNumber, session);
    }
  }

  // ── T3 · Ruteo de la foto por menú (awaiting_type / awaiting_media) ─────────

  /**
   * Llegó una foto sin flujo activo: la buferea (`bufferedMedia`) y deja la sesión
   * esperando que el remitente elija el tipo (buildTypeMenu). Persiste client_id/canal
   * para que la elección + el ruteo no re-pregunten la agencia.
   */
  async setAwaitingType(
    phoneNumber: string,
    media: { storagePath: string; mimeType: string; caption: string; eventId: string },
    clientId: string,
    canalId: string | null,
  ): Promise<void> {
    const existing = await this.get(phoneNumber);
    const session: WhatsAppSession = {
      projects: existing?.projects ?? [],
      base64: existing?.base64 ?? '',
      mimeType: existing?.mimeType ?? '',
      caption: existing?.caption ?? '',
      lastProjectId: existing?.lastProjectId,
      updatedAt: '',
      ...existing,
      state: 'awaiting_type',
      bufferedMedia: media,
      // Buffereamos una foto nueva para preguntar el tipo: cualquier pendingType previo
      // (de un awaiting_media abandonado) quedaría stale → limpiarlo.
      pendingType: null,
      clientId,
      canalId,
    };
    await this.set(phoneNumber, session);
  }

  /**
   * El remitente eligió el tipo por texto ANTES de mandar la foto: fija `pendingType`
   * y deja la sesión esperando la media. La próxima foto rutea directo por `pendingType`.
   */
  async setAwaitingMedia(
    phoneNumber: string,
    type: 'factura' | 'material' | 'evidencia',
    clientId: string,
  ): Promise<void> {
    const existing = await this.get(phoneNumber);
    const session: WhatsAppSession = {
      projects: existing?.projects ?? [],
      base64: existing?.base64 ?? '',
      mimeType: existing?.mimeType ?? '',
      caption: existing?.caption ?? '',
      canalId: existing?.canalId ?? null,
      lastProjectId: existing?.lastProjectId,
      updatedAt: '',
      ...existing,
      state: 'awaiting_media',
      pendingType: type,
      // Fijamos el tipo antes de recibir la foto: no arrastrar una foto buffereada previa
      // (de un awaiting_type abandonado) que rutearía con el tipo equivocado.
      bufferedMedia: null,
      clientId,
    };
    await this.set(phoneNumber, session);
  }

  /** Sale del ruteo por menú (tras rutear la foto o abandonar el intento). */
  async clearMediaFlow(phoneNumber: string): Promise<void> {
    const session = await this.get(phoneNumber);
    if (!session) return;
    if (session.state === 'awaiting_type' || session.state === 'awaiting_media') {
      session.state = '';
      session.pendingType = null;
      session.bufferedMedia = null;
      await this.set(phoneNumber, session);
    }
  }

  // ── Dedup atómico de mensajes entrantes ─────────────────────────────────────
  //
  // SET NX es el primitivo atómico de dedup que reemplaza el chequeo racy contra
  // la DB (isDuplicate). El SELECT sobre eventos_crudos.idempotency_key es un
  // check-then-act: entre el SELECT y el INSERT (que ocurre recién después del
  // download lento del media) hay una ventana en la que Meta reintenta el webhook
  // y el mensaje se procesa dos veces. `SET key val NX` sólo escribe si la clave
  // NO existe y devuelve 'OK'; si ya existe devuelve null. Así el primer worker
  // que reclama el messageId gana la carrera y los reintentos se descartan.

  /** Reclama el messageId de forma atómica. true = recién reclamado; false = ya existía (duplicado). */
  async claimMessage(messageId: string): Promise<boolean> {
    const res = await this.redis.set(
      `${DEDUP_PREFIX}${messageId}`,
      '1',
      'EX',
      DEDUP_TTL_SECONDS,
      'NX',
    );
    return res === 'OK';
  }

  /** Libera la reclamación para permitir el reintento de Meta si el procesamiento falló. */
  async releaseMessage(messageId: string): Promise<void> {
    await this.redis.del(`${DEDUP_PREFIX}${messageId}`);
  }

  // ── Claim atómico del registro de material (A4 / JD-003) ────────────────────
  //
  // El registro de material POP crea SKUs + movimientos de inventario, escrituras
  // IRREVERSIBLES. Dos pins de ubicación concurrentes (messageIds distintos, ambos
  // pasan el dedup por-messageId) pueden leer step==='ubicacion' y llamar register()
  // los dos → SKUs/movimientos duplicados. `SET key val NX` es el mismo primitivo
  // atómico que claimMessage: el primero que reclama el eventoCrudoId del intake gana
  // y el segundo hace no-op limpio. Keyed por el evento crudo del material (estable
  // durante toda la conversación), NO por el messageId del pin (que varía).

  /** Reclama el registro de un intake de material de forma atómica. true = recién reclamado; false = ya reclamado. */
  async claimMaterialRegistration(eventoCrudoId: string): Promise<boolean> {
    const res = await this.redis.set(
      `${DEDUP_PREFIX}material:${eventoCrudoId}`,
      '1',
      'EX',
      DEDUP_TTL_SECONDS,
      'NX',
    );
    return res === 'OK';
  }

  /**
   * Libera el claim de registro de material. Se llama SOLO cuando el registro falló,
   * para no bloquear 24h un reintento legítimo del mismo evento. En el camino de éxito
   * el claim se conserva a propósito (es lo que evita el doble registro).
   */
  async releaseMaterialRegistration(eventoCrudoId: string): Promise<void> {
    await this.redis.del(`${DEDUP_PREFIX}material:${eventoCrudoId}`);
  }

  // ── Claim atómico del registro de evidencia (A4 / JD-003) ───────────────────
  //
  // Mismo riesgo que el material: dos pins de ubicación concurrentes (messageIds
  // distintos, ambos pasan el dedup por-messageId) pueden leer step==='ubicacion'
  // y llamar register() los dos → checkins duplicados (registro de presencia doble).
  // Keyed por el evento crudo del intake de evidencia (estable durante la conversación).

  /** Reclama el registro de un intake de evidencia de forma atómica. true = recién reclamado; false = ya reclamado. */
  async claimEvidenceRegistration(eventoCrudoId: string): Promise<boolean> {
    const res = await this.redis.set(
      `${DEDUP_PREFIX}evidence:${eventoCrudoId}`,
      '1',
      'EX',
      DEDUP_TTL_SECONDS,
      'NX',
    );
    return res === 'OK';
  }

  /**
   * Libera el claim de registro de evidencia. Se llama SOLO cuando el registro falló,
   * para no bloquear 24h un reintento legítimo. En el camino de éxito el claim se
   * conserva a propósito (es lo que evita el doble registro).
   */
  async releaseEvidenceRegistration(eventoCrudoId: string): Promise<void> {
    await this.redis.del(`${DEDUP_PREFIX}evidence:${eventoCrudoId}`);
  }
}
