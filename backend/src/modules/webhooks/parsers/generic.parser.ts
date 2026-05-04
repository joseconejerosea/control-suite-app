import { createHash } from 'crypto';
import { IEventParser, ParsedEvent } from './parser.interface';

export class GenericParser implements IEventParser {
  parse(rawBody: Buffer, _headers: Record<string, string>): ParsedEvent {
    // sha256 of raw body as idempotency source
    const hash = createHash('sha256').update(rawBody).digest('hex');


    // are still persisted instead of throwing an unhandled SyntaxError
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString());
    } catch {
      return {
        normalizedPayload: { raw: rawBody.toString(), parseError: true },
        idempotencySource: hash,
      };
    }

    return {
      normalizedPayload: body,
      idempotencySource: hash,
    };
  }
}