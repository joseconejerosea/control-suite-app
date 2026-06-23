import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export interface ShieldResult {
  safe: boolean;
  reason?: string;
  category?: 'injection' | 'sensitive' | 'length' | 'safe';
  /** Texto saneado (HTML/control chars removidos, truncado). Solo cuando safe. */
  sanitized?: string;
}

/**
 * Patrones de inyección de prompt — EN + ES (voseo/tuteo) + variantes.
 * H7: la lista vieja era solo inglés; injection en español pasaba derecho.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  // Inglés
  /ignore (previous|all|the above) instructions/i,
  /disregard (your|the) (rules|instructions|guidelines)/i,
  /forget (your|the|all) (rules|guidelines|instructions)/i,
  /you are now/i,
  /pretend (you are|to be)/i,
  /act as (if|though|a)/i,
  /jailbreak/i,
  /system prompt/i,
  /override (safety|guidelines|rules)/i,
  /developer mode/i,
  // Español (tuteo + voseo)
  /ignor[áa] (las |todas las )?(instrucciones|reglas|directrices)/i,
  /olvid[áa] (tus |las |todas las )?(reglas|instrucciones|directrices|gu[ií]as)/i,
  /desestim[áa] (las |tus )?(reglas|instrucciones)/i,
  /actu[áa] como (si|un|una)/i,
  /haz de cuenta|hac[ée] de cuenta/i,
  /fing[íi] (ser|que)/i,
  /(eres|sos) ahora/i,
  /prompt del sistema|mensaje del sistema/i,
  /anul[áa] (l[oa]s |tus |sus )?(reglas|directrices|restricciones|seguridad|filtros)/i,
  /desactiv[áa] (l[oa]s |tus |sus )?(reglas|restricciones|filtros)/i,
  /modo (desarrollador|sin restricciones)/i,
];

/**
 * Encoded payloads: intentos de meter instrucciones ofuscadas (base64,
 * escapes unicode/hex, atob/fromCharCode). Raro en mensajes legítimos.
 */
const ENCODED_PATTERNS: RegExp[] = [
  /\\u[0-9a-f]{4}/i,
  /\\x[0-9a-f]{2}/i,
  /\b(atob|fromcharcode|base ?64|unescape)\b/i,
  /(decodific[áa]|decode (this|the|el|este))/i,
];

/** Datos sensibles que el usuario NO debería pegar en el chat. */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(contrase[ñn]a|password|clave)\b/i,
  /tarjeta de (cr[ée]dito|debito|d[ée]bito)/i,
  /n[úu]mero de cuenta/i,
];

const MAX_LEN = 4000;

@Injectable()
export class PromptShieldService {
  private readonly logger = new Logger(PromptShieldService.name);
  private readonly anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /**
   * Chequeo local determinístico — sin costo de API, no puede fail-open.
   * Trata el texto como dato NO confiable.
   */
  checkLocal(text: string): ShieldResult {
    if (!text?.trim()) return { safe: true, category: 'safe', sanitized: '' };

    if (text.length > MAX_LEN) {
      return { safe: false, reason: 'Mensaje demasiado largo', category: 'length' };
    }

    for (const pattern of [...BLOCKED_PATTERNS, ...ENCODED_PATTERNS]) {
      if (pattern.test(text)) {
        this.logger.warn(`[PromptShield] Patrón de inyección detectado: ${pattern}`);
        return {
          safe: false,
          reason: 'Intento de inyección de prompt detectado',
          category: 'injection',
        };
      }
    }

    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(text)) {
        return {
          safe: false,
          reason: 'Datos sensibles detectados — no incluyas información confidencial',
          category: 'sensitive',
        };
      }
    }

    const sanitized = text
      .replace(/<[^>]*>/g, '') // tags HTML
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // control chars
      .trim()
      .slice(0, MAX_LEN);

    return { safe: true, category: 'safe', sanitized };
  }

  /**
   * Chequeo con clasificador IA para casos dudosos.
   *
   * H7: ahora **fail-closed**. Antes, si el clasificador fallaba devolvía
   * `safe: true` (fail-open) → un atacante podía forzar el error para saltear
   * el shield. Ante cualquier error de la API, bloqueamos.
   */
  async checkWithAI(text: string, clientId: string): Promise<ShieldResult> {
    const local = this.checkLocal(text);
    if (!local.safe) return local;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 100,
        system:
          'You are a security classifier. Respond ONLY with JSON: {"safe": true/false, "reason": "..."}',
        messages: [
          {
            role: 'user',
            content: `Is this message safe for a business BTL operations assistant? Message: "${text.slice(0, 500)}"`,
          },
        ],
      });

      const txt = (response.content[0] as any)?.text ?? '';
      const clean = txt.replace(/```json|```/g, '').trim();
      const result = JSON.parse(clean);
      // Si el modelo no devuelve un booleano claro, fail-closed.
      if (typeof result.safe !== 'boolean') {
        return { safe: false, reason: 'Clasificador IA respondió formato inesperado', category: 'injection' };
      }
      return { safe: result.safe, reason: result.reason, category: result.safe ? 'safe' : 'injection' };
    } catch (err: any) {
      this.logger.error(`[PromptShield] AI check failed — bloqueando (fail-closed): ${err?.message}`);
      return {
        safe: false,
        reason: 'No se pudo verificar la seguridad del mensaje',
        category: 'injection',
      };
    }
  }
}
