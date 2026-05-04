export interface IEventParser {
  parse(rawBody: Buffer, headers: Record<string, string>): ParsedEvent;
}

export interface ParsedEvent {
  normalizedPayload: Record<string, unknown>;
  idempotencySource: string; // unique identifier from the source (message ID, email ID, etc.)
}
