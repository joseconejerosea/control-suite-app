import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { WhatsAppService } from './whatsapp.service';

const LOCK_PREFIX = 'wa:out:';
const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minutos

/**
 * F4 Tier 2 · Fase 4 (INFRA) — capa de salida de WhatsApp con lock de idempotencia.
 *
 * El envío masivo de convocatoria (projects.service.enviarConvocatoria) es
 * disparado por un operador; un doble click / reintento / doble job mandaría el
 * WhatsApp dos veces al mismo promotor. Este servicio envuelve sendText con un
 * lock Redis SET NX EX: la MISMA clave de dedup no vuelve a enviar dentro de la
 * ventana (5 min por defecto). El lock es best-effort — si Redis falla, se envía
 * igual (fail-open): perder un mensaje es peor que arriesgar un duplicado.
 */
@Injectable()
export class WhatsappOutputService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappOutputService.name);
  private redis: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly wa: WhatsAppService,
  ) {}

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
    this.logger.log('WhatsApp output lock store initialized (Redis)');
  }

  /**
   * Envía un texto SI el lock de `dedupKey` no está tomado. Devuelve:
   *  - { sent: true }              → se adquirió el lock y se envió (result = envío)
   *  - { sent: false, skipped }    → lock ya tomado, envío suprimido (duplicado)
   *
   * @param dedupKey  identifica el mensaje lógico (p.ej. convocatoria+persona+día).
   */
  async sendTextOnce(
    to: string,
    message: string,
    dedupKey: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<{ sent: boolean; skipped?: boolean; ok?: boolean }> {
    const acquired = await this.acquire(dedupKey, ttlSeconds);
    if (!acquired) {
      this.logger.warn(`[F4] Envío suprimido por lock (dup) key=${dedupKey}`);
      return { sent: false, skipped: true };
    }
    const ok = await this.wa.sendText(to, message);
    return { sent: true, ok };
  }

  /**
   * Compuerta de idempotencia para callers que formatean el mensaje ellos mismos
   * (p.ej. projects.service.enviarConvocatoria usa wa.enviarConvocatoria). Devuelve
   * true si se debe enviar (lock adquirido), false si es un duplicado a suprimir.
   */
  async guard(dedupKey: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<boolean> {
    const ok = await this.acquire(dedupKey, ttlSeconds);
    if (!ok) this.logger.warn(`[F4] Envío suprimido por lock (dup) key=${dedupKey}`);
    return ok;
  }

  /** Intenta tomar el lock. true = adquirido; false = ya existía (o Redis caído → fail-open). */
  private async acquire(dedupKey: string, ttlSeconds: number): Promise<boolean> {
    try {
      const res = await this.redis.set(`${LOCK_PREFIX}${dedupKey}`, '1', 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch (err: any) {
      this.logger.error(`[F4] Redis lock error key=${dedupKey}: ${err.message} — fail-open (envío igual)`);
      return true; // fail-open: preferimos un posible duplicado a perder el mensaje
    }
  }
}
