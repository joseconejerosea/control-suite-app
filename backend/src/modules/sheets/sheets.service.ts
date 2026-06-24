import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { google } from 'googleapis';

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ─── Get OAuth client with saved tokens ───────────────────────────────────
  private async getAuthClient(clientId: string): Promise<any> {
    const oAuth2Client = new google.auth.OAuth2(
      this.config.get('GMAIL_CLIENT_ID'),
      this.config.get('GMAIL_CLIENT_SECRET'),
      this.config.get('GMAIL_REDIRECT_URI'),
    );

    // C3 — tokens per-tenant (ya no el buzón global GMAIL_EMAIL).
    const rows = await this.dataSource.query(
      `SELECT tokens FROM gmail_tokens WHERE client_id = $1 AND tokens IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
      [clientId],
    );
    if (!rows.length) throw new Error('No Gmail OAuth tokens found for this client. Connect Gmail first.');

    const tokens = typeof rows[0].tokens === 'string'
      ? JSON.parse(rows[0].tokens)
      : rows[0].tokens;

    oAuth2Client.setCredentials(tokens);
    return oAuth2Client;
  }

  // ─── Get Sheet ID for a client ────────────────────────────────────────────
  private async getSheetId(clientId: string): Promise<string | null> {
    // First check client config (la columna es `config`, no `config_f1`)
    const clientRows = await this.dataSource.query(
      `SELECT config FROM clients WHERE id = $1 LIMIT 1`,
      [clientId],
    );
    if (clientRows.length && clientRows[0].config?.sheets_id) {
      return clientRows[0].config.sheets_id;
    }

    // Fallback: check canal_entrada config (la columna es `is_active`, no `activo`)
    const canalRows = await this.dataSource.query(
      `SELECT config FROM canal_entrada WHERE client_id = $1 AND is_active = true LIMIT 1`,
      [clientId],
    );
    if (canalRows.length && canalRows[0].config?.sheets_id) {
      return canalRows[0].config.sheets_id;
    }

    // Fallback: env var
    const envSheetId = this.config.get<string>('GOOGLE_SHEETS_ID');
    return envSheetId ?? null;
  }

  // ─── Ensure tabs exist (Gastos, Ventas, Costos) ───────────────────────────
  private async ensureTabs(sheets: any, spreadsheetId: string): Promise<void> {
    const tabs = ['Gastos', 'Ventas', 'Costos'];
    try {
      const res = await sheets.spreadsheets.get({ spreadsheetId });
      const existing = (res.data.sheets ?? []).map((s: any) => s.properties?.title);

      const toCreate = tabs.filter(t => !existing.includes(t));
      if (!toCreate.length) return;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: toCreate.map(title => ({
            addSheet: { properties: { title } },
          })),
        },
      });

      // Add headers to new tabs
      for (const tab of toCreate) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${tab}!A1:I1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [['ID', 'Fecha', 'Proveedor', 'Monto', 'Moneda', 'Tipo', 'Categoria', 'Origen', 'Confianza']],
          },
        });
      }

      this.logger.log(`[SheetsExport] Created tabs: ${toCreate.join(', ')}`);
    } catch (err: any) {
      this.logger.warn(`[SheetsExport] Could not ensure tabs: ${err.message}`);
    }
  }

  // ─── Main export function ─────────────────────────────────────────────────
  async exportInvoice(clientId: string, invoice: {
    id: string;
    vendor_name: string | null;
    amount: number | null;
    currency: string;
    invoice_date: string | null;
    category: string;
    description: string | null;
    source: string;
    confidence_score?: number | null;
    ai_classification?: any;
  }): Promise<void> {
    try {
      const sheetId = await this.getSheetId(clientId);
      if (!sheetId) {
        this.logger.log(`[SheetsExport] No Sheet ID for client ${clientId} — skipping`);
        return;
      }

      const auth = await this.getAuthClient(clientId);
      const sheets = google.sheets({ version: 'v4', auth });

      await this.ensureTabs(sheets, sheetId);

      // Determine tab
      const tab = invoice.category === 'sale' ? 'Ventas'
        : invoice.category === 'cost' ? 'Costos'
        : 'Gastos';

      const tipo = invoice.ai_classification?.tipo ?? invoice.description ?? '—';
      const categoria = invoice.ai_classification?.categoria ?? '—';
      const confidence = invoice.confidence_score
        ? `${Math.round(invoice.confidence_score * 100)}%`
        : '—';

      const row = [
        invoice.id.slice(0, 8),
        invoice.invoice_date ?? new Date().toISOString().split('T')[0],
        invoice.vendor_name ?? '—',
        invoice.amount ?? 0,
        invoice.currency ?? 'CLP',
        tipo,
        categoria,
        invoice.source,
        confidence,
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${tab}!A:I`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });

      this.logger.log(`[SheetsExport] Row appended to "${tab}" in sheet ${sheetId}`);
    } catch (err: any) {
      // Non-fatal — log and continue
      this.logger.warn(`[SheetsExport] Failed to export invoice: ${err.message}`);
    }
  }

  // ─── Soft delete — mark row as deleted in sheet ───────────────────────────
  async markDeleted(clientId: string, invoiceId: string): Promise<void> {
    try {
      const sheetId = await this.getSheetId(clientId);
      if (!sheetId) return;

      // Finding and marking deleted is complex — log only for now
      this.logger.log(`[SheetsExport] Invoice ${invoiceId} deleted — should mark in sheet`);
    } catch (err: any) {
      this.logger.warn(`[SheetsExport] markDeleted failed: ${err.message}`);
    }
  }
}