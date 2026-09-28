import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  AttachmentRef,
  MailboxProvider,
  MailboxSession,
  MailProvider,
  NormalizedMessage,
  OAuthTokens,
} from '../mail-provider.interface';

const GRAPH = 'https://graph.microsoft.com/v1.0';
// Consent: Mail.Read (leer correos) + offline_access (refresh_token) + openid/email
// (conocer la cuenta conectada). No pedimos nada de escritura.
const SCOPE = 'offline_access openid email https://graph.microsoft.com/Mail.Read';
const INVOICE_MIME = (mime: string) => mime.startsWith('image/') || mime === 'application/pdf';

/**
 * Outlook provider — OAuth + message access via Microsoft Graph, using plain
 * `fetch` (no MSAL/SDK dependency). Unlike googleapis, Graph does NOT auto-refresh:
 * access tokens expire ~1h, so the session refreshes explicitly using the stored
 * refresh_token and exposes the updated tokens via currentTokens() so the
 * ingestion layer persists them back.
 */
@Injectable()
export class OutlookProvider implements MailboxProvider {
  readonly id: MailProvider = 'outlook';
  private readonly logger = new Logger(OutlookProvider.name);

  private static readonly ENV_KEYS = [
    'OUTLOOK_CLIENT_ID',
    'OUTLOOK_CLIENT_SECRET',
    'OUTLOOK_REDIRECT_URI',
  ] as const;

  constructor(private readonly config: ConfigService) {}

  private tenant(): string {
    return this.config.get('OUTLOOK_TENANT') ?? 'common';
  }
  private authority(): string {
    return `https://login.microsoftonline.com/${this.tenant()}/oauth2/v2.0`;
  }

  isConfigured(): boolean {
    return OutlookProvider.ENV_KEYS.every((k) => !!this.config.get(k));
  }

  assertConfigured(): void {
    const missing = OutlookProvider.ENV_KEYS.filter((k) => !this.config.get(k));
    if (missing.length) {
      throw AppException.config(
        `Outlook OAuth no configurado: faltan env vars [${missing.join(', ')}]`,
        503,
      );
    }
  }

  getAuthUrl(state: string): string {
    this.assertConfigured();
    const params = new URLSearchParams({
      client_id: this.config.get('OUTLOOK_CLIENT_ID')!,
      response_type: 'code',
      redirect_uri: this.config.get('OUTLOOK_REDIRECT_URI')!,
      response_mode: 'query',
      scope: SCOPE,
      state,
    });
    return `${this.authority()}/authorize?${params.toString()}`;
  }

  /** POST al token endpoint (authorization_code o refresh_token). */
  private async tokenRequest(body: Record<string, string>): Promise<OAuthTokens> {
    const res = await fetch(`${this.authority()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.get('OUTLOOK_CLIENT_ID')!,
        client_secret: this.config.get('OUTLOOK_CLIENT_SECRET')!,
        scope: SCOPE,
        ...body,
      }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Outlook token endpoint ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as any;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry: Date.now() + (Number(data.expires_in) || 0) * 1000,
      scope: data.scope,
    };
  }

  async exchangeCode(code: string): Promise<{ email: string; tokens: OAuthTokens }> {
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.get('OUTLOOK_REDIRECT_URI')!,
    });

    const meRes = await fetch(`${GRAPH}/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!meRes.ok) throw new Error(`Outlook /me ${meRes.status}`);
    const me = (await meRes.json()) as any;
    const email = me.mail ?? me.userPrincipalName;
    if (!email) throw new Error('Microsoft no devolvió el email de la cuenta conectada');
    return { email, tokens };
  }

  openSession(tokens: OAuthTokens): MailboxSession {
    let current: OAuthTokens = typeof tokens === 'string' ? JSON.parse(tokens) : { ...tokens };
    const self = this;

    const refresh = async (): Promise<void> => {
      const prevRefresh = current.refresh_token;
      if (!prevRefresh) throw new Error('Outlook session sin refresh_token');
      current = await self.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: prevRefresh,
      });
      // Azure puede NO rotar el refresh_token; si no vino uno nuevo, conservamos el último conocido.
      if (!current.refresh_token) current.refresh_token = prevRefresh;
    };

    const ensureFresh = async (): Promise<void> => {
      const expiry = Number(current.expiry) || 0;
      if (!current.access_token || Date.now() >= expiry - 60_000) {
        await refresh();
      }
    };

    const graphGet = async (path: string, headers: Record<string, string> = {}): Promise<any> => {
      await ensureFresh();
      let res = await fetch(`${GRAPH}${path}`, {
        headers: { Authorization: `Bearer ${current.access_token}`, ...headers },
      });
      if (res.status === 401) {
        // token revocado/expirado antes de tiempo → un refresh y reintento único.
        await refresh();
        res = await fetch(`${GRAPH}${path}`, {
          headers: { Authorization: `Bearer ${current.access_token}`, ...headers },
        });
      }
      if (!res.ok) throw new Error(`Graph GET ${path} → ${res.status}`);
      return res.json();
    };

    return {
      async listRecentIds(afterEpochSec: number): Promise<string[]> {
        const iso = new Date(afterEpochSec * 1000).toISOString();
        const path =
          `/me/messages?$select=id&$top=20` +
          `&$filter=${encodeURIComponent(`receivedDateTime ge ${iso}`)}`;
        const data = await graphGet(path);
        return (data.value ?? []).map((m: any) => m.id).filter(Boolean);
      },

      async getMessage(id: string): Promise<NormalizedMessage> {
        // Prefer text body → evita HTML crudo en la extracción con IA.
        const msg = await graphGet(
          `/me/messages/${encodeURIComponent(id)}?$select=subject,from,body,hasAttachments`,
          { Prefer: 'outlook.body-content-type="text"' },
        );
        const addr = msg.from?.emailAddress ?? {};
        const from = addr.name ? `${addr.name} <${addr.address ?? ''}>` : addr.address ?? '';

        let attachments: AttachmentRef[] = [];
        if (msg.hasAttachments) {
          const att = await graphGet(`/me/messages/${encodeURIComponent(id)}/attachments?$select=id,contentType`);
          attachments = (att.value ?? [])
            .filter((a: any) => INVOICE_MIME(a.contentType ?? ''))
            .map((a: any) => ({ id: a.id, mimeType: a.contentType }));
        }

        return {
          id,
          subject: msg.subject ?? '',
          from,
          body: msg.body?.content ?? '',
          attachments,
        };
      },

      async getAttachmentBase64(messageId: string, attachmentId: string): Promise<string> {
        // fileAttachment.contentBytes ya es base64 estándar (listo para Anthropic).
        const att = await graphGet(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
        return att.contentBytes ?? '';
      },

      currentTokens(): OAuthTokens {
        return current;
      },
    };
  }
}
