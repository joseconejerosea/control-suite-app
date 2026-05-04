import { createHash } from 'crypto';
import { IEventParser, ParsedEvent } from './parser.interface';

export class WhatsAppParser implements IEventParser {
  parse(rawBody: Buffer, _headers: Record<string, string>): ParsedEvent {
    let body: Record<string, unknown>;

  
    // are still persisted instead of throwing an unhandled SyntaxError
    try {
      body = JSON.parse(rawBody.toString());
    } catch {
      return {
        normalizedPayload: { raw: rawBody.toString(), parseError: true },
        idempotencySource: createHash('sha256').update(rawBody).digest('hex'),
      };
    }

    // Extract from Meta/WhatsApp Business API webhook format
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    const from: string = message?.from ?? '';
    const messageId: string = message?.id ?? `waid-${Date.now()}`;
    const timestamp: string = message?.timestamp ?? String(Date.now());
    const type: string = message?.type ?? 'unknown';

    let text: string | null = null;
    if (type === 'text') {
      text = message?.text?.body ?? null;
    }

    const normalizedPayload: Record<string, unknown> = {
      from,
      text,
      timestamp,
      messageId,
      type,
      phoneNumberId: value?.metadata?.phone_number_id ?? null,
      displayPhoneNumber: value?.metadata?.display_phone_number ?? null,
      raw: body, // preserve original for auditability
    };

    return {
      normalizedPayload,
      idempotencySource: messageId, // WhatsApp guarantees unique message IDs
    };
  }
}