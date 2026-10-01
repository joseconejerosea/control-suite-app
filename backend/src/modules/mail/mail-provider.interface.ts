/**
 * MailboxProvider — the provider-specific surface of the email-ingestion pipeline.
 *
 * Everything that differs between mail providers (Gmail via googleapis, Outlook
 * via Microsoft Graph) lives behind this interface: OAuth (consent URL + code
 * exchange) and message access (list / read / attachments). Everything that is
 * provider-agnostic — the poll loop, the staff gate, AI extraction, feedback→
 * incidencia matching, dedup and the signed CSRF `state` — lives once in
 * MailIngestionService.
 */

export type MailProvider = 'gmail' | 'outlook';

/** Opaque OAuth token bag as returned/stored by each provider. */
export type OAuthTokens = Record<string, any>;

/** Attachment metadata (NO bytes) — bytes are fetched lazily, only for staff. */
export interface AttachmentRef {
  id: string;
  mimeType: string;
}

/** A message normalized to the fields the pipeline actually uses. */
export interface NormalizedMessage {
  id: string;
  subject: string;
  from: string;
  body: string;
  attachments: AttachmentRef[];
}

/**
 * A per-poll session bound to one mailbox's tokens. It MAY refresh the access
 * token internally (Graph tokens expire ~1h; googleapis refreshes on the fly).
 * After the poll, MailIngestionService reads `currentTokens()` and persists them
 * back if they changed — so a refreshed token survives to the next poll.
 */
export interface MailboxSession {
  /** Message ids received at/after `afterEpochSec` (unix seconds). */
  listRecentIds(afterEpochSec: number): Promise<string[]>;
  /** Full normalized message (headers, body, attachment refs). */
  getMessage(id: string): Promise<NormalizedMessage>;
  /** Standard-base64 bytes of one attachment (ready for the Anthropic API). */
  getAttachmentBase64(messageId: string, attachmentId: string): Promise<string>;
  /** Tokens as they stand now — possibly refreshed during the session. */
  currentTokens(): OAuthTokens;
}

export interface MailboxProvider {
  readonly id: MailProvider;

  /** True when the provider's OAuth env vars are present. */
  isConfigured(): boolean;
  /** Throws AppException.config (503) naming the missing env vars. */
  assertConfigured(): void;

  /**
   * OAuth consent URL. `state` is the signed CSRF token built by the ingestion
   * layer (it binds the flow to a client_id); the provider only forwards it.
   */
  getAuthUrl(state: string): string;

  /** Exchange the OAuth `code` for tokens and the connected account's email. */
  exchangeCode(code: string): Promise<{ email: string; tokens: OAuthTokens }>;

  /** Open a token-bound session for one poll cycle. */
  openSession(tokens: OAuthTokens): MailboxSession;
}

/** DI token for the array of registered mailbox providers. */
export const MAILBOX_PROVIDERS = 'MAILBOX_PROVIDERS';
