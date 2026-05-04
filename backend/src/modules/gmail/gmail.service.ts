import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { google } from 'googleapis';
import * as cron from 'node-cron';
import { InvoicesService } from '../invoices/invoices.service';

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoicesService: InvoicesService,
  ) {
    cron.schedule('*/10 * * * * *', async () => {
      this.logger.log('[GmailService] Auto-polling all connected Gmail accounts...');
      await this.pollAllClients().catch(e =>
        this.logger.error(`[GmailService] Auto-poll failed: ${e}`)
      );
    });

    this.logger.log('[GmailService] Auto-poll cron scheduled (every 10 sec)');
  }

  private getOAuthClient(): any {
    return new google.auth.OAuth2(
      this.config.get('GMAIL_CLIENT_ID'),
      this.config.get('GMAIL_CLIENT_SECRET'),
      this.config.get('GMAIL_REDIRECT_URI'),
    );
  }

  getAuthUrl(): string {
    const client = this.getOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    });
  }

  async handleCallback(code: string, clientId?: string): Promise<string> {
    const oAuth2Client = this.getOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const email = this.config.get('GMAIL_EMAIL');
    const resolvedClientId = clientId ?? this.config.get('GMAIL_DEFAULT_CLIENT_ID') ?? null;

    await this.dataSource.query(
      `INSERT INTO gmail_tokens (email, tokens, client_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET tokens = $2, client_id = $3, updated_at = now()`,
      [email, JSON.stringify(tokens), resolvedClientId],
    );

    this.logger.log(`[GmailService] OAuth tokens saved for email: ${email}, clientId: ${resolvedClientId}`);
    return 'Gmail connected successfully!';
  }

  async pollAllClients(): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT email, tokens, client_id FROM gmail_tokens WHERE tokens IS NOT NULL`,
    );

    for (const row of rows) {
      const clientId = row.client_id ?? this.config.get('GMAIL_DEFAULT_CLIENT_ID');
      if (!clientId) {
        this.logger.warn(`[GmailService] No client_id for email ${row.email} — skipping`);
        continue;
      }
      await this.pollInbox(clientId, row.email, row.tokens).catch(e =>
        this.logger.error(`[GmailService] Poll failed for ${row.email}: ${e}`)
      );
    }
  }

  async loadTokensForClient(email: string): Promise<any | null> {
    try {
      const rows = await this.dataSource.query(
        `SELECT tokens FROM gmail_tokens WHERE email = $1 LIMIT 1`,
        [email],
      );
      if (!rows.length) return null;
      return typeof rows[0].tokens === 'string'
        ? JSON.parse(rows[0].tokens)
        : rows[0].tokens;
    } catch (e) {
      this.logger.error(`[GmailService] loadTokens error: ${e}`);
      return null;
    }
  }

  async pollInbox(clientId: string, email?: string, rawTokens?: any): Promise<{ checked: number; saved: number }> {
    const tokenEmail = email ?? this.config.get('GMAIL_EMAIL');

    let tokens = rawTokens;
    if (!tokens) {
      tokens = await this.loadTokensForClient(tokenEmail);
    }
    if (!tokens) {
      this.logger.warn(`[GmailService] No Gmail tokens found for ${tokenEmail}`);
      return { checked: 0, saved: 0 };
    }

    const oAuth2Client = this.getOAuthClient();
    oAuth2Client.setCredentials(typeof tokens === 'string' ? JSON.parse(tokens) : tokens);
    this.logger.log('[GmailService] Tokens loaded successfully');

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const after = Math.floor((Date.now() - 15 * 60 * 1000) / 1000);

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${after}`,
      maxResults: 20,
    });

    const messages = res.data.messages ?? [];
    this.logger.log(`[GmailService] Found ${messages.length} emails to check for client ${clientId}`);
    let saved = 0;

    for (const msg of messages) {
      try {
        const exists = await this.dataSource.query(
          `SELECT 1 FROM invoices WHERE raw_payload->>'gmail_id' = $1 AND client_id = $2 LIMIT 1`,
          [msg.id, clientId],
        );
        if (exists.length) continue;

        const full = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });

        const headers = full.data.payload?.headers ?? [];
        const subject = headers.find((h) => h.name === 'Subject')?.value ?? '';
        const from    = headers.find((h) => h.name === 'From')?.value ?? '';
        const body    = this.extractBody(full.data.payload);

        const imageAttachments = this.findImageAttachments(full.data.payload);
        let invoice: any = null;

        if (imageAttachments.length > 0) {
          this.logger.log(`[GmailService] Found ${imageAttachments.length} image(s) in email: "${subject}"`);
          for (const att of imageAttachments) {
            try {
              const attRes = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: msg.id!,
                id: att.attachmentId!,
              });
              const imageData = (attRes.data.data ?? '')
                .replace(/-/g, '+')
                .replace(/_/g, '/');
              const mimeType = att.mimeType ?? 'image/jpeg';
              invoice = await this.extractInvoiceFromImage(imageData, mimeType);
              if (invoice?.is_invoice) break;
            } catch (err) {
              this.logger.warn(`[GmailService] Failed to process attachment: ${err}`);
            }
          }
        }

        if (!invoice?.is_invoice && (body || subject)) {
          const text = `Subject: ${subject}\nFrom: ${from}\n\n${body}`;
          invoice = await this.extractInvoiceFromText(text);
        }

        if (invoice?.is_invoice) {
          const today = new Date().toISOString().split('T')[0];
          const invoiceDate = invoice.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(invoice.invoice_date)
            ? invoice.invoice_date
            : today;

          await this.invoicesService.createFromWebhook(
            clientId,
            'email',
            { ...invoice, invoice_date: invoiceDate },
            { subject, from, body: body.slice(0, 500), gmail_id: msg.id },
          );
          saved++;
          this.logger.log(`[GmailService] Invoice saved from email: "${subject}" — vendor: ${invoice.vendor_name}, amount: ${invoice.amount}`);
        } else {
          this.logger.log(`[GmailService] Not an invoice: "${subject}"`);
        }
      } catch (err) {
        this.logger.error(`[GmailService] Error processing email ${msg.id}: ${err}`);
      }
    }

    return { checked: messages.length, saved };
  }

  private findImageAttachments(payload: any): Array<{ attachmentId: string; mimeType: string }> {
    const results: Array<{ attachmentId: string; mimeType: string }> = [];
    if (!payload) return results;

    const scanPart = (part: any) => {
      if (!part) return;
      const mime = part.mimeType ?? '';
      if (mime.startsWith('image/') && part.body?.attachmentId) {
        results.push({ attachmentId: part.body.attachmentId, mimeType: mime });
      }
      if (part.parts) {
        for (const p of part.parts) scanPart(p);
      }
    };

    scanPart(payload);
    return results;
  }

  private parseAIResponse(raw: string): any {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(cleaned);
  }

  private async extractInvoiceFromImage(base64Data: string, mimeType: string): Promise<any> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
              { type: 'text', text: `Eres un extractor de facturas y boletas chilenas. Analiza esta imagen.

REGLAS:
- Si NO es factura/boleta/recibo → {"is_invoice": false}
- Si ES factura/boleta/recibo → extrae TODOS los datos
- amount: busca "TOTAL", "MONTO TOTAL", "Total" — extrae el numero sin simbolos (ej: 11000)
- vendor_name: nombre del comercio/empresa emisora
- description: que se compro/servicio prestado (ej: "Lavado de auto", "Venta Tarjeta de Credito")
- invoice_date: formato YYYY-MM-DD (ej: 2026-01-16)
- currency: "CLP" por defecto para Chile
- category: "expense" para gastos, "sale" para ventas

Output SOLO JSON valido, sin markdown:
{
  "is_invoice": true,
  "vendor_name": "nombre comercio",
  "amount": 11000,
  "currency": "CLP",
  "invoice_date": "YYYY-MM-DD",
  "category": "expense",
  "description": "descripcion del producto/servicio"
}` },
            ],
          }],
        }),
      });

      if (!response.ok) return null;
      const data = await response.json() as any;
      return this.parseAIResponse(data?.content?.[0]?.text ?? '');
    } catch (e) {
      this.logger.error(`[GmailService] extractInvoiceFromImage error: ${e}`);
      return null;
    }
  }

  private async extractInvoiceFromText(text: string): Promise<any> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: `Eres un extractor de facturas chilenas. Analiza este email.

REGLAS:
- Si NO contiene factura/boleta/recibo → {"is_invoice": false}
- Si contiene factura/boleta → extrae datos
- amount: numero total sin simbolos (ej: 11000)
- description: que se compro/servicio

Output SOLO JSON valido, sin markdown:
{
  "is_invoice": true,
  "vendor_name": "nombre comercio",
  "amount": 11000,
  "currency": "CLP",
  "invoice_date": "YYYY-MM-DD",
  "category": "expense",
  "description": "descripcion del producto/servicio"
}

Email:
${text.slice(0, 3000)}` }],
        }),
      });

      if (!response.ok) return null;
      const data = await response.json() as any;
      return this.parseAIResponse(data?.content?.[0]?.text ?? '');
    } catch (e) {
      this.logger.error(`[GmailService] extractInvoiceFromText error: ${e}`);
      return null;
    }
  }

  private extractBody(payload: any): string {
    if (!payload) return '';
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
    }
    return '';
  }
}