import { Injectable, Logger } from '@nestjs/common';

const BLOCKED_PATTERNS = [
  /ignore (previous|all) instructions/i,
  /you are now/i,
  /act as/i,
  /jailbreak/i,
  /disregard your/i,
  /forget your (rules|guidelines|instructions)/i,
  /system prompt/i,
  /override (safety|guidelines)/i,
];

const SENSITIVE_PATTERNS = [
  /contraseña|password|clave/i,
  /tarjeta de (crédito|credito)/i,
  /número de cuenta/i,
];

export interface ShieldResult {
  safe: boolean;
  reason?: string;
  category?: 'injection' | 'sensitive' | 'safe';
  sanitized?: string;
}

@Injectable()
export class PromptShieldService {
  private readonly logger = new Logger(PromptShieldService.name);

  analyze(text: string): ShieldResult {
    if (!text?.trim()) return { safe: true, category: 'safe' };

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(text)) {
        this.logger.warn(`[PromptShield] Injection detected`);
        return { safe: false, reason: 'Prompt injection detectado', category: 'injection' };
      }
    }

    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(text)) {
        return { safe: false, reason: 'Datos sensibles detectados — no incluyas información confidencial', category: 'sensitive' };
      }
    }

    const sanitized = text.replace(/<[^>]*>/g, '').replace(/\x00/g, '').trim().slice(0, 4000);
    return { safe: true, category: 'safe', sanitized };
  }
}
