import { IEventParser, ParsedEvent } from './parser.interface';
import { createHash } from 'crypto';

export class EmailParser implements IEventParser {
  parse(rawBody: Buffer, headers: Record<string, string>): ParsedEvent {
    let body: Record<string, unknown>;

    try {
      body = JSON.parse(rawBody.toString());
    } catch {
      return {
        normalizedPayload: { raw: rawBody.toString(), parseError: true },
        idempotencySource: createHash('sha256').update(rawBody).digest('hex'),
      };
    }

    // Inbound email webhook format (SendGrid/Mailgun style)
    const from: string = (body?.from ?? body?.sender ?? '') as string;
    const to: string = (body?.to ?? body?.recipient ?? '') as string;
    const subject: string = (body?.subject ?? '') as string;
    const bodyPlain: string = (body?.text ?? body?.body_plain ?? body?.plain ?? '') as string;
    const bodyHtml: string = (body?.html ?? body?.body_html ?? '') as string;
    const attachments: unknown[] = (body?.attachments ?? []) as unknown[];

    // Message-ID from email headers (RFC 5322 unique identifier)
    const bodyHeaders = body?.headers as Record<string, string> | undefined;
    const messageId: string =
      bodyHeaders?.['Message-Id'] ??
      bodyHeaders?.['Message-ID'] ??
      (body?.message_id as string | undefined) ??
      headers?.['message-id'] ??
      createHash('sha256').update(rawBody).digest('hex');

    const normalizedPayload: Record<string, unknown> = {
      from,
      to,
      subject,
      body_plain: bodyPlain,
      body_html: bodyHtml,
      attachments,
      messageId,
    };

    return {
      normalizedPayload,
      idempotencySource: messageId,
    };
  }
}