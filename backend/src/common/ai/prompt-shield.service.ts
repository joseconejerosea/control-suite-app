import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export interface ShieldResult {
  safe: boolean;
  reason?: string;
  category?: string;
}

const BLOCKED_PATTERNS = [
  /ignore (previous|all) instructions/i,
  /you are now/i,
  /pretend (you are|to be)/i,
  /jailbreak/i,
  /system prompt/i,
  /disregard (your|the) (rules|instructions)/i,
  /act as (if|though)/i,
];

@Injectable()
export class PromptShieldService {
  private readonly logger = new Logger(PromptShieldService.name);
  private readonly anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /**
   * Quick local check — sin costo de API
   */
  checkLocal(text: string): ShieldResult {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(text)) {
        this.logger.warn(`[PromptShield] Blocked pattern detected: ${pattern}`);
        return { safe: false, reason: 'Prompt injection attempt detected', category: 'injection' };
      }
    }
    if (text.length > 4000) {
      return { safe: false, reason: 'Message too long', category: 'length' };
    }
    return { safe: true };
  }

  /**
   * AI-based check para casos dudosos
   */
  async checkWithAI(text: string, clientId: string): Promise<ShieldResult> {
    const local = this.checkLocal(text);
    if (!local.safe) return local;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 100,
        system: 'You are a security classifier. Respond ONLY with JSON: {"safe": true/false, "reason": "..."}',
        messages: [{
          role: 'user',
          content: `Is this message safe for a business BTL operations assistant? Message: "${text.slice(0, 500)}"`,
        }],
      });

      const txt = (response.content[0] as any).text ?? '{"safe":true}';
      const clean = txt.replace(/```json|```/g, '').trim();
      const result = JSON.parse(clean);
      return { safe: result.safe ?? true, reason: result.reason };
    } catch (err: any) {
      this.logger.error('[PromptShield] AI check failed, allowing:', err.message);
      return { safe: true };
    }
  }
}
