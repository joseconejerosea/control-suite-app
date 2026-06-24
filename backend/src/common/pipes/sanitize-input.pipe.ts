import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|above)\s+instructions?/i,
  /system\s*prompt/i,
  /you\s+are\s+now/i,
  /forget\s+(everything|all|your)/i,
  /act\s+as\s+(a\s+)?(?!user|admin)/i,
  /\bDAN\b/,
  /jailbreak/i,
  /<\s*script/i,
  /javascript:/i,
];

@Injectable()
export class SanitizeInputPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (typeof value === 'string') {
      this.checkForInjection(value);
      return value.trim();
    }
    if (typeof value === 'object' && value !== null) {
      return this.sanitizeObject(value as Record<string, unknown>);
    }
    return value;
  }

  private checkForInjection(text: string): void {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        throw new BadRequestException('Input contains disallowed content');
      }
    }
  }

  private sanitizeValue(val: unknown): unknown {
    if (typeof val === 'string') {
      this.checkForInjection(val);
      return val.trim();
    }
    if (typeof val === 'object' && val !== null) {
      return this.sanitizeObject(val as Record<string, unknown>);
    }
    return val;
  }

  private sanitizeObject(
    obj: Record<string, unknown>,
  ): Record<string, unknown> | unknown[] {
    // Preservar arrays: si reconstruimos con un objeto literal, un array
    // termina como {"0":..,"1":..} y rompe todo consumidor que espere `[...]`
    // (incl. el body de webhooks tipo WhatsApp y cualquier DTO con string[]).
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeValue(item));
    }
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      sanitized[key] = this.sanitizeValue(obj[key]);
    }
    return sanitized;
  }
}