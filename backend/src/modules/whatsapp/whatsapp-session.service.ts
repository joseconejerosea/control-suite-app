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
    step: 'kind' | 'nombre' | 'proyecto' | 'bodega' | 'cantidad';
    attempts: number;
    suggestedLabel?: string | null;      // nombre sugerido por la visión (ambigüedad/ayuda)
    nombre?: string;
    proyectoId?: string;
    bodegaId?: string;
    cantidad?: number;
    projects?: { id: string; name: string }[];  // opciones cacheadas para parsear el número
    bodegas?: { id: string; name: string }[];
  } | null;
  // F5 · Intake de evidencia de actividad por foto (personas/anfitrionas en el evento).
  // Estado de sesión asociado: state === 'awaiting_evidence'. La evidencia se registra
  // como un checkin (prueba de presencia) de la activación activa del remitente.
  evidenceIntake?: {
    eventoCrudoId: string;
    storagePath: string;                            // foto de la evidencia → foto_key del checkin
    step: 'activacion' | 'observacion';
    attempts: number;
    personaId: string;                              // promotor resuelto (persona_id del checkin)
    activaciones?: { id: string; label: string }[]; // opciones numeradas cacheadas
    activacionId?: string;
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
}
