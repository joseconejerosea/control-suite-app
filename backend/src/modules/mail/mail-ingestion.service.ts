import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as cron from 'node-cron';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { InvoicesService } from '../invoices/invoices.service';
import { OperatorNotifierService } from '../whatsapp/operator-notifier.service';
import { runWithTenant, runAsSystem } from '../../common/tenant/tenant-context';
import {
  MailboxProvider,
  MailProvider,
  MAILBOX_PROVIDERS,
  OAuthTokens,
} from './mail-provider.interface';

/**
 * MailIngestionService — the provider-agnostic email-ingestion pipeline.
 *
 * Owns everything that does NOT depend on the mail provider: the poll cron, the
 * signed CSRF `state`, the staff gate, AI invoice extraction, feedback→incidencia
 * matching, dedup and the tenant-scoped token store. The provider-specific bits
 * (OAuth + message access) are delegated to a MailboxProvider resolved by id.
 */
@Injectable()
export class MailIngestionService {
  private readonly logger = new Logger(MailIngestionService.name);
  private readonly providers = new Map<MailProvider, MailboxProvider>();
  private polling = false;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoicesService: InvoicesService,
    private readonly notifier: OperatorNotifierService,
    @Inject(MAILBOX_PROVIDERS) providers: MailboxProvider[],
  ) {
    for (const p of providers) this.providers.set(p.id, p);

    cron.schedule('*/10 * * * * *', async () => {
      this.logger.log('[MailIngestion] Auto-polling all connected mailboxes...');
      await this.pollAllClients().catch((e) =>
        this.logger.error(`[MailIngestion] Auto-poll failed: ${e}`),
      );
    });
    this.logger.log(
      `[MailIngestion] Auto-poll cron scheduled (every 10 sec) — providers: [${[...this.providers.keys()].join(', ')}]`,
    );
  }

  /** Provider registered under `id`, or throw (unknown/unsupported provider). */
  getProvider(id: string): MailboxProvider {
    const p = this.providers.get(id as MailProvider);
    if (!p) throw new UnauthorizedException(`Unsupported mail provider: ${id}`);
    return p;
  }

  /** Provider ids currently wired (used by the controller to validate the route). */
  supportedProviders(): MailProvider[] {
    return [...this.providers.keys()];
  }

  // ── CSRF state (firmado, con expiración) ──────────────────────────────────
  // El state liga el flujo OAuth a un client_id. Firmado con HMAC para que el
  // callback no confíe en input crudo (login-CSRF). TTL corto (10 min).
  private stateSecret(): string {
    return this.config.get<string>('JWT_SECRET') ?? '';
  }

  private buildState(clientId: string, provider: string): string {
    const secret = this.stateSecret();
    if (!secret) throw new Error('JWT_SECRET no configurado: no se puede firmar el state OAuth');
    const payload = { c: clientId, p: provider, n: randomBytes(8).toString('hex'), e: Date.now() + 10 * 60 * 1000 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyState(state: string): { clientId: string; provider?: string } {
    const secret = this.stateSecret();
    if (!secret) throw new Error('JWT_SECRET no configurado: no se puede verificar el state OAuth');
    const [body, sig] = (state ?? '').split('.');
    if (!body || !sig) throw new UnauthorizedException('Invalid OAuth state');

    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('OAuth state signature mismatch');
    }

    let payload: { c?: string; e?: number; p?: string };
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    } catch {
      throw new UnauthorizedException('Malformed OAuth state');
    }
    if (typeof payload.e !== 'number' || Date.now() > payload.e) {
      throw new UnauthorizedException('OAuth state expired');
    }
    if (!payload.c) throw new UnauthorizedException('OAuth state missing tenant');
    return { clientId: payload.c, provider: (payload as any).p };
  }

  // ── OAuth connect / callback ──────────────────────────────────────────────

  getAuthUrl(providerId: string, clientId: string): string {
    if (!clientId) throw new UnauthorizedException('No tenant context to start mail OAuth');
    const provider = this.getProvider(providerId);
    provider.assertConfigured();
    return provider.getAuthUrl(this.buildState(clientId, provider.id));
  }

  async handleCallback(providerId: string, code: string, state: string): Promise<string> {
    // CSRF: el client_id sale del state firmado, no de un parámetro crudo.
    const { clientId, provider: stateProvider } = this.verifyState(state);
    if (stateProvider && stateProvider !== providerId) throw new UnauthorizedException('OAuth state provider mismatch');
    const provider = this.getProvider(providerId);

    const { email, tokens } = await provider.exchangeCode(code);

    // Insert dentro del contexto del tenant (setea app.current_tenant → satisface
    // el WITH CHECK de RLS; defensa en profundidad además del client_id explícito).
    await runWithTenant(this.dataSource, clientId, () =>
      this.dataSource.query(
        `INSERT INTO gmail_tokens (email, tokens, client_id, provider)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id, provider, email) DO UPDATE SET tokens = $2, updated_at = now()`,
        [email, JSON.stringify(tokens), clientId, provider.id],
      ),
    );

    this.logger.log(`[MailIngestion] OAuth tokens saved — provider: ${providerId}, email: ${email}, clientId: ${clientId}`);
    return email;
  }

  // ── Poll ──────────────────────────────────────────────────────────────────

  // Barrida cross-tenant legítima (cron + /poll super_admin) → runAsSystem.
  async pollAllClients(): Promise<void> {
    if (this.polling) {
      this.logger.warn('[MailIngestion] poll ya en curso — skip (evita solape del cron)');
      return;
    }
    this.polling = true;
    try {
      await runAsSystem(async () => {
        const rows = await this.dataSource.query(
          `SELECT email, tokens, client_id, provider FROM gmail_tokens WHERE tokens IS NOT NULL`,
        );
        for (const row of rows) {
          if (!row.client_id) {
            this.logger.warn(`[MailIngestion] token row sin client_id (email ${row.email}) — skipping`);
            continue;
          }
          await this.pollInbox(row.provider ?? 'gmail', row.client_id, row.email, row.tokens).catch((e) =>
            this.logger.error(`[MailIngestion] Poll failed for ${row.provider}/${row.email}: ${e}`),
          );
        }
      });
    } finally {
      this.polling = false;
    }
  }

  async statusForTenant(
    clientId: string,
    provider: string = 'gmail',
  ): Promise<{ connected: boolean; accounts: string[] }> {
    if (!clientId) return { connected: false, accounts: [] };
    this.getProvider(provider);
    const rows = await this.dataSource
      .query(
        `SELECT email FROM gmail_tokens WHERE client_id = $1 AND provider = $2 AND tokens IS NOT NULL ORDER BY updated_at DESC`,
        [clientId, provider],
      )
      .catch(() => []);
    const accounts = rows.map((r: any) => r.email);
    return { connected: accounts.length > 0, accounts };
  }

  async disconnectTenant(
    clientId: string,
    provider: string = 'gmail',
  ): Promise<{ ok: boolean; removed: number }> {
    if (!clientId) throw new UnauthorizedException('No tenant context to disconnect mail');
    this.getProvider(provider);
    const rows = await runWithTenant(this.dataSource, clientId, () =>
      this.dataSource.query(
        `DELETE FROM gmail_tokens WHERE client_id = $1 AND provider = $2 RETURNING email`,
        [clientId, provider],
      ),
    );
    const removed = Array.isArray(rows) ? rows.length : 0;
    this.logger.log(`[MailIngestion] Mail (${provider}) disconnected for client ${clientId} — ${removed} account(s) removed`);
    return { ok: true, removed };
  }

  async loadTokensForClient(clientId: string, email: string, provider: string = 'gmail'): Promise<any | null> {
    try {
      const rows = await this.dataSource.query(
        `SELECT tokens FROM gmail_tokens WHERE client_id = $1 AND email = $2 AND provider = $3 LIMIT 1`,
        [clientId, email, provider],
      );
      if (!rows.length) return null;
      return typeof rows[0].tokens === 'string' ? JSON.parse(rows[0].tokens) : rows[0].tokens;
    } catch (e) {
      this.logger.error(`[MailIngestion] loadTokens error: ${e}`);
      return null;
    }
  }

  async pollInbox(
    providerId: string,
    clientId: string,
    email?: string,
    rawTokens?: any,
  ): Promise<{ checked: number; saved: number }> {
    const provider = this.getProvider(providerId);

    let tokens = rawTokens;
    if (!tokens && email) {
      tokens = await this.loadTokensForClient(clientId, email, providerId);
    }
    if (!tokens) {
      this.logger.warn(`[MailIngestion] No tokens found for client ${clientId} / ${email ?? 'unknown'}`);
      return { checked: 0, saved: 0 };
    }

    const session = provider.openSession(tokens);
    const originalTokens = JSON.stringify(session.currentTokens());
    const after = Math.floor((Date.now() - 15 * 60 * 1000) / 1000);

    let saved = 0;

    try {
      const ids = await session.listRecentIds(after);
      this.logger.log(`[MailIngestion] Found ${ids.length} emails to check for client ${clientId} (${providerId})`);

      for (const id of ids) {
      try {
        // Anti-reprocesamiento: si este correo ya tuvo un desenlace terminal en un
        // poll anterior (factura, feedback o descartado), no lo volvemos a tocar.
        const seen = await this.dataSource.query(
          `SELECT 1 FROM gmail_processed_emails WHERE client_id = $1 AND provider = $2 AND gmail_id = $3 LIMIT 1`,
          [clientId, providerId, id],
        );
        if (seen.length) continue;

        // Compat: facturas guardadas ANTES de la tabla de procesados (sin marca).
        const exists = await this.dataSource.query(
          `SELECT 1 FROM invoices WHERE raw_payload->>'gmail_id' = $1 AND client_id = $2 AND (raw_payload->>'provider' IS NULL OR raw_payload->>'provider' = $3) LIMIT 1`,
          [id, clientId, providerId],
        );
        if (exists.length) continue;

        const msg = await session.getMessage(id);
        const { subject, from, body } = msg;

        // Gate de facturas: solo el STAFF del tenant puede inyectar comprobantes por
        // correo. Corre ANTES de la IA → un remitente no autorizado no gasta tokens.
        // El feedback del cliente NO se gatea acá (su puerta es matchReporte).
        const senderEmail = this.extractEmailAddress(from).toLowerCase();
        const senderIsStaff = await this.isAuthorizedInvoiceSender(clientId, senderEmail);

        const attachments = senderIsStaff ? msg.attachments : [];
        let invoice: any = null;
        // Un fallo TRANSITORIO (red/IA/descarga de adjunto) NO debe quedar enmascarado
        // por un resultado terminal posterior. Caso real: el adjunto (la factura) falla
        // transitoriamente (invoice=null) y el fallback de texto devuelve "no factura"
        // ({is_invoice:false}) → sin este flag el correo se marcaría 'ignored' y la
        // factura se perdería para siempre. extractInvoice* devuelve null SOLO ante
        // fallo transitorio; {is_invoice:false} es una respuesta terminal.
        let transientFailure = false;

        if (attachments.length > 0) {
          this.logger.log(`[MailIngestion] Found ${attachments.length} adjunto(s) in email: "${subject}"`);
          for (const att of attachments) {
            try {
              const fileData = await session.getAttachmentBase64(id, att.id);
              const r = await this.extractInvoiceFromDocument(fileData, att.mimeType);
              if (r === null) { transientFailure = true; continue; } // fallo transitorio → reintentar
              invoice = r;
              if (invoice?.is_invoice) break;
            } catch (err) {
              transientFailure = true; // no se pudo bajar/procesar el adjunto → transitorio
              this.logger.warn(`[MailIngestion] Failed to process attachment: ${err}`);
            }
          }
        }

        if (senderIsStaff && !invoice?.is_invoice && (body || subject)) {
          const text = `Subject: ${subject}\nFrom: ${from}\n\n${body}`;
          const r = await this.extractInvoiceFromText(text);
          if (r === null) transientFailure = true; // no sobreescribir con terminal si el texto falló
          else invoice = r;
        }

        // ¿Se intentó extracción con IA? Distingue un "no factura" terminal (marcar)
        // de un fallo transitorio de la IA (reintentar).
        const aiAttempted = senderIsStaff && (attachments.length > 0 || !!(body || subject));

        let outcome: 'invoice' | 'feedback' | 'ignored' | null = null;

        if (invoice?.is_invoice) {
          const today = new Date().toISOString().split('T')[0];
          const invoiceDate =
            invoice.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(invoice.invoice_date)
              ? invoice.invoice_date
              : today;

          await this.invoicesService.createFromWebhook(
            clientId,
            'email',
            { ...invoice, invoice_date: invoiceDate },
            { subject, from, body: body.slice(0, 500), gmail_id: id, provider: providerId },
          );
          saved++;
          outcome = 'invoice';
          this.logger.log(`[MailIngestion] Invoice saved from email: "${subject}" — vendor: ${invoice.vendor_name}, amount: ${invoice.amount}`);
        } else {
          const created = await this.tryCreateIncidenciaFromFeedback(clientId, { subject, from, body }).catch((e) => {
            this.logger.error(`[MailIngestion] feedback→incidencia error: ${e}`);
            return false;
          });
          if (created) {
            saved++;
            outcome = 'feedback';
          } else if (transientFailure) {
            // Alguna extracción falló transitoriamente y no hubo factura ni feedback →
            // NO marcar; se reintenta el próximo poll (dentro de la ventana de 15 min).
            this.logger.warn(`[MailIngestion] AI extraction failed (transient) — will retry: "${subject}"`);
          } else if (!aiAttempted || invoice !== null) {
            outcome = 'ignored';
            this.logger.log(`[MailIngestion] Not an invoice / no match: "${subject}"`);
          } else {
            this.logger.warn(`[MailIngestion] AI extraction failed — will retry: "${subject}"`);
          }
        }

        if (outcome) {
          await this.markEmailProcessed(clientId, providerId, id, outcome);
        }
      } catch (err) {
        this.logger.error(`[MailIngestion] Error processing email ${id}: ${err}`);
      }
      }

      return { checked: ids.length, saved };
    } finally {
      // Persistir tokens si la sesión los refrescó (Graph expira ~1h; Gmail refresca
      // solo). Sin esto, Outlook empieza a 401-ear tras 1h y la ingesta muere. En el
      // finally → se persiste aunque listRecentIds/el loop tiren (refresh ya ocurrió).
      await this.persistRefreshedTokens(clientId, email, providerId, originalTokens, session.currentTokens());
    }
  }

  private async persistRefreshedTokens(
    clientId: string,
    email: string | undefined,
    provider: string,
    originalJson: string,
    current: OAuthTokens,
  ): Promise<void> {
    if (!email) return; // sin email no podemos ubicar la fila
    const currentJson = JSON.stringify(current);
    if (currentJson === originalJson) return;
    await runWithTenant(this.dataSource, clientId, () =>
      this.dataSource.query(
        `UPDATE gmail_tokens SET tokens = $1, updated_at = now() WHERE client_id = $2 AND email = $3 AND provider = $4`,
        [currentJson, clientId, email, provider],
      ),
    ).catch((e) => this.logger.error(`[MailIngestion] persistRefreshedTokens error: ${e}`));
  }

  // ── Feedback del cliente por email → NOVEDAD (incidencia source='EMAIL') ────
  private async tryCreateIncidenciaFromFeedback(
    clientId: string,
    email: { subject: string; from: string; body: string },
  ): Promise<boolean> {
    if (!email.body && !email.subject) return false;

    const rep = await this.matchReporte(clientId, email);
    if (!rep) return false;

    const fromEmail = this.extractEmailAddress(email.from);
    const descripcion = this.buildIncidenciaDescripcion(email);

    const incidenciaId = await runWithTenant(this.dataSource, clientId, async () => {
      const dup = await this.dataSource.query(
        `SELECT id FROM incidencias
          WHERE activacion_id=$1 AND client_id=$2 AND source='EMAIL' AND descripcion=$3
          LIMIT 1`,
        [rep.activacion_id, clientId, descripcion],
      );
      if (dup.length) return null;

      const ins = await this.dataSource.query(
        `INSERT INTO incidencias
           (client_id, activacion_id, persona_id, descripcion, categoria, severidad, estado, source)
         VALUES ($1,$2,NULL,$3,'feedback_cliente','media','abierta','EMAIL')
         RETURNING id`,
        [clientId, rep.activacion_id, descripcion],
      );
      return ins[0]?.id ?? null;
    });

    if (!incidenciaId) return false;

    this.logger.log(
      `[MailIngestion] Incidencia EMAIL creada (${incidenciaId}) para activación ${rep.activacion_id} — from: ${fromEmail}, match: ${rep.matchBy}`,
    );

    await this.notifier
      .notificar(
        clientId,
        `📧 Feedback del cliente recibido por email en activación ${rep.activacion_id}: ${email.subject || '(sin asunto)'}`,
        `email-feedback:${incidenciaId}`,
      )
      .catch(() => {});

    return true;
  }

  private async matchReporte(
    clientId: string,
    email: { subject: string; from: string },
  ): Promise<{ activacion_id: string; matchBy: 'token' | 'sender' } | null> {
    return runWithTenant(this.dataSource, clientId, async () => {
      const token = this.extractSubjectToken(email.subject);
      if (token) {
        const rows = await this.dataSource.query(
          `SELECT activacion_id FROM reportes_cliente
            WHERE client_id=$1 AND email_message_id=$2
            ORDER BY enviado_at DESC NULLS LAST LIMIT 1`,
          [clientId, token],
        );
        if (rows[0]?.activacion_id) {
          return { activacion_id: rows[0].activacion_id, matchBy: 'token' as const };
        }
      }

      const fromEmail = this.extractEmailAddress(email.from).toLowerCase();
      if (fromEmail) {
        const rows = await this.dataSource.query(
          `SELECT rc.activacion_id
             FROM reportes_cliente rc
             JOIN activations a ON a.id = rc.activacion_id
             JOIN projects   p ON p.id = a.project_id
            WHERE rc.client_id=$1
              AND rc.estado='enviado'
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(
                  COALESCE(p.config->'report_recipients','[]'::jsonb)
                ) AS r(email)
                WHERE lower(r.email) = $2
              )
            ORDER BY rc.enviado_at DESC NULLS LAST LIMIT 1`,
          [clientId, fromEmail],
        );
        if (rows[0]?.activacion_id) {
          return { activacion_id: rows[0].activacion_id, matchBy: 'sender' as const };
        }
      }

      return null;
    });
  }

  private extractSubjectToken(subject: string): string | null {
    const m = (subject ?? '').match(/\[#([a-z0-9]+)\]/i);
    return m ? m[1].toLowerCase() : null;
  }

  private extractEmailAddress(from: string): string {
    const m = from.match(/<([^>]+)>/);
    if (m) return m[1].trim();
    return from.trim();
  }

  private buildIncidenciaDescripcion(email: { subject: string; body: string }): string {
    const asunto = email.subject ? `${email.subject}\n\n` : '';
    const cuerpo = (email.body ?? '').trim().slice(0, 2000);
    return `${asunto}${cuerpo}`.trim().slice(0, 3900);
  }

  private async markEmailProcessed(
    clientId: string,
    provider: string,
    gmailId: string,
    outcome: 'invoice' | 'feedback' | 'ignored',
  ): Promise<void> {
    await runWithTenant(this.dataSource, clientId, () =>
      this.dataSource.query(
        `INSERT INTO gmail_processed_emails (client_id, provider, gmail_id, outcome)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id, provider, gmail_id) DO NOTHING`,
        [clientId, provider, gmailId, outcome],
      ),
    ).catch((e) => this.logger.error(`[MailIngestion] markEmailProcessed error: ${e}`));
  }

  /**
   * Gate de facturas por email: ¿el remitente es STAFF de este tenant? Autorizados =
   * users / collaborators / promoters del cliente con este email (activos). Corre
   * ANTES de la IA. Fail-closed: ante error de DB, NO autoriza.
   */
  private async isAuthorizedInvoiceSender(clientId: string, email: string): Promise<boolean> {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized) return false;
    try {
      const rows = await this.dataSource.query(
        `SELECT 1 FROM users
           WHERE client_id = $1 AND is_active = true AND lower(email) = $2
         UNION
         SELECT 1 FROM collaborators
           WHERE client_id = $1 AND is_active = true AND lower(email) = $2
         UNION
         SELECT 1 FROM promoters
           WHERE client_id = $1 AND status = 'active' AND lower(email) = $2
         LIMIT 1`,
        [clientId, normalized],
      );
      return rows.length > 0;
    } catch (e) {
      this.logger.error(`[MailIngestion] isAuthorizedInvoiceSender error: ${e}`);
      return false; // fail-closed
    }
  }

  private parseAIResponse(raw: string): any {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  }

  private async extractInvoiceFromDocument(base64Data: string, mimeType: string): Promise<any> {
    const mediaBlock =
      mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
        : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } };
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
          messages: [
            {
              role: 'user',
              content: [
                mediaBlock,
                {
                  type: 'text',
                  text: `Eres un extractor de facturas y boletas chilenas. Analiza este documento.

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
}`,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) return null;              // transient → retry
      const data = (await response.json()) as any;
      try {
        return this.parseAIResponse(data?.content?.[0]?.text ?? '');
      } catch {
        // El modelo respondió pero no es JSON parseable → NO es factura (terminal), no reintentar.
        return { is_invoice: false };
      }
    } catch (e) {
      this.logger.error(`[MailIngestion] extractInvoiceFromDocument error: ${e}`);
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
          messages: [
            {
              role: 'user',
              content: `Eres un extractor de facturas chilenas. Analiza este email.

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
${text.slice(0, 3000)}`,
            },
          ],
        }),
      });

      if (!response.ok) return null;              // transient → retry
      const data = (await response.json()) as any;
      try {
        return this.parseAIResponse(data?.content?.[0]?.text ?? '');
      } catch {
        // El modelo respondió pero no es JSON parseable → NO es factura (terminal), no reintentar.
        return { is_invoice: false };
      }
    } catch (e) {
      this.logger.error(`[MailIngestion] extractInvoiceFromText error: ${e}`);
      return null;
    }
  }
}
