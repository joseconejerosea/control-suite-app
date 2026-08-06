import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { google } from 'googleapis';
import * as cron from 'node-cron';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { InvoicesService } from '../invoices/invoices.service';
import { OperatorNotifierService } from '../whatsapp/operator-notifier.service';
import { runWithTenant, runAsSystem } from '../../common/tenant/tenant-context';

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoicesService: InvoicesService,
    private readonly notifier: OperatorNotifierService,
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

  getAuthUrl(clientId: string): string {
    if (!clientId) {
      throw new UnauthorizedException('No tenant context to start Gmail OAuth');
    }
    const client = this.getOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      // userinfo.email → para conocer la cuenta realmente conectada (no GMAIL_EMAIL).
      // spreadsheets → SheetsService reutiliza estos MISMOS tokens para exportar
      //   facturas (append/batchUpdate). Sin este scope, la exportación falla con
      //   403 insufficient scope. El consentimiento es único (Gmail + Sheets).
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
      state: this.buildState(clientId),
    });
  }

  // ── CSRF state (firmado, con expiración) ──────────────────────────────────
  // El state liga el flujo OAuth a un client_id. Va firmado con HMAC para que el
  // callback no confíe en input crudo (login-CSRF). TTL corto (10 min).
  private stateSecret(): string {
    return this.config.get<string>('JWT_SECRET') ?? '';
  }

  private buildState(clientId: string): string {
    const secret = this.stateSecret();
    if (!secret) throw new Error('JWT_SECRET no configurado: no se puede firmar el state OAuth');
    const payload = { c: clientId, n: randomBytes(8).toString('hex'), e: Date.now() + 10 * 60 * 1000 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyState(state: string): string {
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

    let payload: { c?: string; e?: number };
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    } catch {
      throw new UnauthorizedException('Malformed OAuth state');
    }
    if (typeof payload.e !== 'number' || Date.now() > payload.e) {
      throw new UnauthorizedException('OAuth state expired');
    }
    if (!payload.c) throw new UnauthorizedException('OAuth state missing tenant');
    return payload.c;
  }

  async handleCallback(code: string, state: string): Promise<string> {
    // CSRF: el client_id sale del state firmado, no de un parámetro crudo.
    const clientId = this.verifyState(state);

    const oAuth2Client = this.getOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // El email es el de la cuenta realmente conectada (Google userinfo), no el
    // GMAIL_EMAIL global. Así cada tenant tiene SU buzón.
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const me = await oauth2.userinfo.get();
    const email = me.data.email;
    if (!email) throw new Error('Google no devolvió el email de la cuenta conectada');

    // Insert dentro del contexto del tenant (setea app.current_tenant → satisface
    // el WITH CHECK de RLS; defensa en profundidad además del client_id explícito).
    await runWithTenant(this.dataSource, clientId, () =>
      this.dataSource.query(
        `INSERT INTO gmail_tokens (email, tokens, client_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (client_id, email) DO UPDATE SET tokens = $2, updated_at = now()`,
        [email, JSON.stringify(tokens), clientId],
      ),
    );

    this.logger.log(`[GmailService] OAuth tokens saved — email: ${email}, clientId: ${clientId}`);
    return email;
  }

  // Barrida cross-tenant legítima (cron + /poll super_admin) → runAsSystem. No
  // abre tx larga; los writes por tenant llevan client_id explícito.
  async pollAllClients(): Promise<void> {
    await runAsSystem(async () => {
      const rows = await this.dataSource.query(
        `SELECT email, tokens, client_id FROM gmail_tokens WHERE tokens IS NOT NULL`,
      );

      for (const row of rows) {
        if (!row.client_id) {
          this.logger.warn(`[GmailService] gmail_tokens sin client_id (email ${row.email}) — skipping`);
          continue;
        }
        await this.pollInbox(row.client_id, row.email, row.tokens).catch(e =>
          this.logger.error(`[GmailService] Poll failed for ${row.email}: ${e}`),
        );
      }
    });
  }

  // Desconexión: borra los tokens OAuth del tenant. Scopeado por client_id explícito
  // + runWithTenant para satisfacer el WITH CHECK de RLS (defensa en profundidad).
  // Idempotente: si no había tokens, removed = 0.
  async disconnectTenant(clientId: string): Promise<{ ok: boolean; removed: number }> {
    if (!clientId) throw new UnauthorizedException('No tenant context to disconnect Gmail');
    const rows = await runWithTenant(this.dataSource, clientId, () =>
      this.dataSource.query(
        `DELETE FROM gmail_tokens WHERE client_id = $1 RETURNING email`,
        [clientId],
      ),
    );
    const removed = Array.isArray(rows) ? rows.length : 0;
    this.logger.log(`[GmailService] Gmail disconnected for client ${clientId} — ${removed} account(s) removed`);
    return { ok: true, removed };
  }

  // Status del tenant del request (corre dentro del TenantInterceptor → ya scopeado).
  async statusForTenant(clientId: string): Promise<{ connected: boolean; accounts: string[] }> {
    if (!clientId) return { connected: false, accounts: [] };
    const rows = await this.dataSource.query(
      `SELECT email FROM gmail_tokens WHERE client_id = $1 AND tokens IS NOT NULL ORDER BY updated_at DESC`,
      [clientId],
    ).catch(() => []);
    const accounts = rows.map((r: any) => r.email);
    return { connected: accounts.length > 0, accounts };
  }

  async loadTokensForClient(clientId: string, email: string): Promise<any | null> {
    try {
      const rows = await this.dataSource.query(
        `SELECT tokens FROM gmail_tokens WHERE client_id = $1 AND email = $2 LIMIT 1`,
        [clientId, email],
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
    let tokens = rawTokens;
    if (!tokens && email) {
      tokens = await this.loadTokensForClient(clientId, email);
    }
    if (!tokens) {
      this.logger.warn(`[GmailService] No Gmail tokens found for client ${clientId} / ${email ?? 'unknown'}`);
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
        // Anti-reprocesamiento: si este correo ya tuvo un desenlace terminal en un
        // poll anterior (factura, feedback o descartado), no lo volvemos a tocar.
        // Sin esto, un correo que no es factura se re-lee y se le corre IA en cada
        // poll durante los 15 min de la ventana. Ver migración 061.
        const seen = await this.dataSource.query(
          `SELECT 1 FROM gmail_processed_emails WHERE client_id = $1 AND gmail_id = $2 LIMIT 1`,
          [clientId, msg.id],
        );
        if (seen.length) continue;

        // Compat: facturas guardadas ANTES de la tabla de procesados (sin marca).
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
        const hdr = (name: string) =>
          headers.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
        const subject     = hdr('Subject');
        const from        = hdr('From');
        const body        = this.extractBody(full.data.payload);

        // Gate de facturas: solo el STAFF del tenant (users/collaborators/promoters
        // con este email) puede inyectar comprobantes por correo. Corre ANTES de la
        // IA → un remitente no autorizado no gasta tokens de extracción. El feedback
        // del cliente NO se gatea acá: tiene su propia puerta en matchReporte
        // (token / report_recipients), porque el cliente final no es staff.
        const senderEmail = this.extractEmailAddress(from).toLowerCase();
        const senderIsStaff = await this.isAuthorizedInvoiceSender(clientId, senderEmail);

        const attachments = senderIsStaff
          ? this.findInvoiceAttachments(full.data.payload)
          : [];
        let invoice: any = null;

        if (attachments.length > 0) {
          this.logger.log(`[GmailService] Found ${attachments.length} adjunto(s) (imagen/PDF) in email: "${subject}"`);
          for (const att of attachments) {
            try {
              const attRes = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: msg.id!,
                id: att.attachmentId!,
              });
              const fileData = (attRes.data.data ?? '')
                .replace(/-/g, '+')
                .replace(/_/g, '/');
              const mimeType = att.mimeType ?? 'image/jpeg';
              invoice = await this.extractInvoiceFromDocument(fileData, mimeType);
              if (invoice?.is_invoice) break;
            } catch (err) {
              this.logger.warn(`[GmailService] Failed to process attachment: ${err}`);
            }
          }
        }

        if (senderIsStaff && !invoice?.is_invoice && (body || subject)) {
          const text = `Subject: ${subject}\nFrom: ${from}\n\n${body}`;
          invoice = await this.extractInvoiceFromText(text);
        }

        // ¿Se intentó extracción con IA? Solo si el remitente es staff y había algo
        // que analizar. Distingue un "no factura" terminal (marcar) de un fallo
        // transitorio de la IA (reintentar).
        const aiAttempted = senderIsStaff && (attachments.length > 0 || !!(body || subject));

        // Desenlace del correo. Solo marcamos como procesado cuando llegamos a un
        // estado TERMINAL; si la IA falló (null) dejamos sin marca para reintentar.
        let outcome: 'invoice' | 'feedback' | 'ignored' | null = null;

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
          outcome = 'invoice';
          this.logger.log(`[GmailService] Invoice saved from email: "${subject}" — vendor: ${invoice.vendor_name}, amount: ${invoice.amount}`);
        } else {
          // No es factura → intentamos tratarlo como feedback del cliente (respuesta
          // al reporte) y convertirlo en una NOVEDAD/incidencia de la activación.
          const created = await this.tryCreateIncidenciaFromFeedback(clientId, {
            subject, from, body,
          }).catch((e) => {
            this.logger.error(`[GmailService] feedback→incidencia error: ${e}`);
            return false;
          });
          if (created) {
            saved++;
            outcome = 'feedback';
          } else if (!aiAttempted || invoice !== null) {
            // Terminal: no se intentó IA (remitente no-staff o correo vacío) o la IA
            // respondió definitivamente "no es factura", y no hubo match de feedback.
            // No hay nada más que hacer → marcar para no reprocesar.
            outcome = 'ignored';
            this.logger.log(`[GmailService] Not an invoice / no match: "${subject}"`);
          } else {
            // La IA se intentó pero falló (red / respuesta no parseable) → NO marcar,
            // se reintenta en el próximo poll mientras siga en la ventana de 15 min.
            this.logger.warn(`[GmailService] AI extraction failed — will retry: "${subject}"`);
          }
        }

        if (outcome && msg.id) {
          await this.markEmailProcessed(clientId, msg.id, outcome);
        }
      } catch (err) {
        this.logger.error(`[GmailService] Error processing email ${msg.id}: ${err}`);
      }
    }

    return { checked: messages.length, saved };
  }

  /**
   * Feedback del cliente por email → NOVEDAD (incidencia con source='EMAIL').
   *
   * MATCHING (en orden de preferencia):
   *   a) TOKEN en el asunto: `[#token]` que embebimos al enviar el reporte y
   *      guardamos en reportes_cliente.email_message_id. Sobrevive en la respuesta
   *      del cliente (`Re: ... [#token]`). Es el camino confiable — no dependemos
   *      del Message-ID, que Resend controla y no permite fijar.
   *   b) FALLBACK por remitente: el email del `from` figura en
   *      projects.config.report_recipients de un proyecto que tiene una activación
   *      con reporte ENVIADO. Heurística — puede matchear un reporte que no es el
   *      que el cliente estaba respondiendo si el mismo destinatario recibió varios.
   *
   * Si no matchea NINGUNO → no se crea incidencia (no queremos huérfanas sin
   * activación). Devuelve true si creó una incidencia.
   *
   * La creación corre bajo runWithTenant(clientId): pollInbox se ejecuta dentro de
   * runAsSystem (cross-tenant) y el INSERT de incidencia debe ir scopeado al tenant
   * para satisfacer RLS.
   */
  private async tryCreateIncidenciaFromFeedback(
    clientId: string,
    email: { subject: string; from: string; body: string },
  ): Promise<boolean> {
    // Ignoramos correos que no parecen respuestas ni traen cuerpo útil.
    if (!email.body && !email.subject) return false;

    const rep = await this.matchReporte(clientId, email);
    if (!rep) return false;

    const fromEmail = this.extractEmailAddress(email.from);
    const descripcion = this.buildIncidenciaDescripcion(email);

    // Dedup: si ya creamos una incidencia EMAIL con esta misma descripción para la
    // activación (reprocesamiento del mismo correo), no duplicamos.
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
      `[GmailService] Incidencia EMAIL creada (${incidenciaId}) para activación ${rep.activacion_id} — from: ${fromEmail}, match: ${rep.matchBy}`,
    );

    // Notificación al operador (mismo patrón que F5 Fase 3). Best-effort.
    await this.notifier
      .notificar(
        clientId,
        `📧 Feedback del cliente recibido por email en activación ${rep.activacion_id}: ${email.subject || '(sin asunto)'}`,
        `email-feedback:${incidenciaId}`,
      )
      .catch(() => {});

    return true;
  }

  /**
   * Resuelve el reporte (y su activación) al que corresponde el correo entrante.
   * Devuelve { activacion_id, matchBy } o null.
   */
  private async matchReporte(
    clientId: string,
    email: { subject: string; from: string },
  ): Promise<{ activacion_id: string; matchBy: 'token' | 'sender' } | null> {
    return runWithTenant(this.dataSource, clientId, async () => {
      // a) Token en el asunto: [#<token>] embebido al enviar, guardado en
      //    reportes_cliente.email_message_id. Sobrevive en la respuesta del cliente.
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

      // b) Fallback por remitente: el from ∈ report_recipients de un proyecto con
      //    reporte enviado. Tomamos el reporte enviado más reciente de ese proyecto.
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

  /** Extrae el token de referencia `[#token]` del asunto de la respuesta (si está). */
  private extractSubjectToken(subject: string): string | null {
    const m = (subject ?? '').match(/\[#([a-z0-9]+)\]/i);
    return m ? m[1].toLowerCase() : null;
  }

  /** Extrae la dirección de un header From del tipo `Nombre <mail@x.com>`. */
  private extractEmailAddress(from: string): string {
    const m = from.match(/<([^>]+)>/);
    if (m) return m[1].trim();
    return from.trim();
  }

  /** Descripción de la incidencia: asunto + cuerpo recortado. */
  private buildIncidenciaDescripcion(email: { subject: string; body: string }): string {
    const asunto = email.subject ? `${email.subject}\n\n` : '';
    const cuerpo = (email.body ?? '').trim().slice(0, 2000);
    return `${asunto}${cuerpo}`.trim().slice(0, 3900);
  }

  /**
   * Adjuntos que pueden contener una factura: imágenes y PDFs. Ambos formatos los
   * banca la Messages API de Anthropic (imagen → bloque `image`, PDF → `document`).
   */
  private findInvoiceAttachments(payload: any): Array<{ attachmentId: string; mimeType: string }> {
    const results: Array<{ attachmentId: string; mimeType: string }> = [];
    if (!payload) return results;

    const isInvoiceMime = (mime: string) =>
      mime.startsWith('image/') || mime === 'application/pdf';

    const scanPart = (part: any) => {
      if (!part) return;
      const mime = part.mimeType ?? '';
      if (isInvoiceMime(mime) && part.body?.attachmentId) {
        results.push({ attachmentId: part.body.attachmentId, mimeType: mime });
      }
      if (part.parts) {
        for (const p of part.parts) scanPart(p);
      }
    };

    scanPart(payload);
    return results;
  }

  /**
   * Marca un correo como ya procesado para este tenant (anti-reprocesamiento del
   * poll). Idempotente. Va bajo runWithTenant porque pollInbox corre en runAsSystem
   * y el INSERT debe quedar scopeado al tenant para satisfacer el WITH CHECK de RLS
   * (mismo patrón que la creación de incidencia en tryCreateIncidenciaFromFeedback).
   */
  private async markEmailProcessed(
    clientId: string,
    gmailId: string,
    outcome: 'invoice' | 'feedback' | 'ignored',
  ): Promise<void> {
    await runWithTenant(this.dataSource, clientId, () =>
      this.dataSource.query(
        `INSERT INTO gmail_processed_emails (client_id, gmail_id, outcome)
         VALUES ($1, $2, $3)
         ON CONFLICT (client_id, gmail_id) DO NOTHING`,
        [clientId, gmailId, outcome],
      ),
    ).catch((e) => this.logger.error(`[GmailService] markEmailProcessed error: ${e}`));
  }

  /**
   * Gate de facturas por email: ¿el remitente es STAFF de este tenant? Autorizados =
   * users / collaborators / promoters del cliente con este email (activos). Espeja el
   * gate de WhatsApp (isAuthorizedSender) pero por correo. Corre ANTES de la IA, así
   * un remitente desconocido no gasta tokens ni puede inyectar facturas falsas.
   * Fail-closed: ante error de DB, NO autoriza.
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
      this.logger.error(`[GmailService] isAuthorizedInvoiceSender error: ${e}`);
      return false; // fail-closed
    }
  }

  private parseAIResponse(raw: string): any {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(cleaned);
  }

  private async extractInvoiceFromDocument(base64Data: string, mimeType: string): Promise<any> {
    // Bloque de contenido según el tipo de adjunto: imágenes → `image`; PDF →
    // `document`. Los dos usan source base64 en la Messages API de Anthropic.
    const mediaBlock = mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
      : { type: 'image',    source: { type: 'base64', media_type: mimeType,          data: base64Data } };
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
              mediaBlock,
              { type: 'text', text: `Eres un extractor de facturas y boletas chilenas. Analiza este documento.

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
      this.logger.error(`[GmailService] extractInvoiceFromDocument error: ${e}`);
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