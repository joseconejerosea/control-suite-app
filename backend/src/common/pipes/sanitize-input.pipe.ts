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

  private sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string') {
        this.checkForInjection(val);
        sanitized[key] = val.trim();
      } else if (typeof val === 'object' && val !== null) {
        sanitized[key] = this.sanitizeObject(val as Record<string, unknown>);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }
}