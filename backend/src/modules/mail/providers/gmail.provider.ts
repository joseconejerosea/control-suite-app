import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  AttachmentRef,
  MailboxProvider,
  MailboxSession,
  MailProvider,
  NormalizedMessage,
  OAuthTokens,
} from '../mail-provider.interface';

/**
 * Gmail provider — OAuth + message access via googleapis. The provider-agnostic
 * pipeline (poll, gate, AI, feedback, dedup, CSRF state) lives in
 * MailIngestionService; this class only speaks Gmail.
 */
@Injectable()
export class GmailProvider implements MailboxProvider {
  readonly id: MailProvider = 'gmail';
  private readonly logger = new Logger(GmailProvider.name);

  private static readonly ENV_KEYS = [
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REDIRECT_URI',
  ] as const;

  constructor(private readonly config: ConfigService) {}

  private getOAuthClient(): any {
    return new google.auth.OAuth2(
      this.config.get('GMAIL_CLIENT_ID'),
      this.config.get('GMAIL_CLIENT_SECRET'),
      this.config.get('GMAIL_REDIRECT_URI'),
    );
  }

  isConfigured(): boolean {
    return GmailProvider.ENV_KEYS.every((k) => !!this.config.get(k));
  }

  // Missing OAuth creds = server config problem, not something the end user can
  // fix. AppException.config → safe generic userMessage; the missing var names go
  // in technicalDetail (logged server-side by the filter, never serialized).
  assertConfigured(): void {
    const missing = GmailProvider.ENV_KEYS.filter((k) => !this.config.get(k));
    if (missing.length) {
      throw AppException.config(
        `Gmail OAuth no configurado: faltan env vars [${missing.join(', ')}]`,
        503,
      );
    }
  }

  getAuthUrl(state: string): string {
    this.assertConfigured();
    const client = this.getOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      // userinfo.email → conocer la cuenta realmente conectada (no un buzón global).
      // spreadsheets → SheetsService reutiliza estos MISMOS tokens para exportar
      //   facturas. Consentimiento único (Gmail + Sheets); es exclusivo de Gmail.
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
      state,
    });
  }

  async exchangeCode(code: string): Promise<{ email: string; tokens: OAuthTokens }> {
    const client = this.getOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    const email = me.data.email;
    if (!email) throw new Error('Google no devolvió el email de la cuenta conectada');
    return { email, tokens };
  }

  openSession(tokens: OAuthTokens): MailboxSession {
    const client = this.getOAuthClient();
    client.setCredentials(typeof tokens === 'string' ? JSON.parse(tokens) : tokens);

    // googleapis refreshes the access token on the fly and emits 'tokens'. Capture
    // the merged result so the ingestion layer can persist it (Gmail previously
    // discarded refreshed tokens — a latent gap this closes for free).
    let latest: OAuthTokens = typeof tokens === 'string' ? JSON.parse(tokens) : { ...tokens };
    client.on('tokens', (t: OAuthTokens) => {
      latest = { ...latest, ...t };
    });

    const gmail = google.gmail({ version: 'v1', auth: client });

    return {
      async listRecentIds(afterEpochSec: number): Promise<string[]> {
        const res = await gmail.users.messages.list({
          userId: 'me',
          q: `after:${afterEpochSec}`,
          maxResults: 20,
        });
        return (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
      },

      async getMessage(id: string): Promise<NormalizedMessage> {
        const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        const headers = full.data.payload?.headers ?? [];
        const hdr = (name: string) =>
          headers.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
        return {
          id,
          subject: hdr('Subject'),
          from: hdr('From'),
          body: GmailProvider.extractBody(full.data.payload),
          attachments: GmailProvider.findInvoiceAttachments(full.data.payload),
        };
      },

      async getAttachmentBase64(messageId: string, attachmentId: string): Promise<string> {
        const attRes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: attachmentId,
        });
        // Gmail returns URL-safe base64; normalize to standard base64 for Anthropic.
        return (attRes.data.data ?? '').replace(/-/g, '+').replace(/_/g, '/');
      },

      currentTokens(): OAuthTokens {
        return latest;
      },
    };
  }

  /** Decodes the plain-text body — recurses into nested multipart to find the first text/plain part. */
  private static extractBody(payload: any): string {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.body?.data && !payload.parts) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        const found = GmailProvider.extractBody(part);
        if (found) return found;
      }
    }
    return '';
  }

  /** Attachments that may hold an invoice: images + PDFs (both accepted by Anthropic). */
  private static findInvoiceAttachments(payload: any): AttachmentRef[] {
    const results: AttachmentRef[] = [];
    if (!payload) return results;
    const isInvoiceMime = (mime: string) => mime.startsWith('image/') || mime === 'application/pdf';
    const scan = (part: any) => {
      if (!part) return;
      const mime = part.mimeType ?? '';
      if (isInvoiceMime(mime) && part.body?.attachmentId) {
        results.push({ id: part.body.attachmentId, mimeType: mime });
      }
      if (part.parts) for (const p of part.parts) scan(p);
    };
    scan(payload);
    return results;
  }
}
