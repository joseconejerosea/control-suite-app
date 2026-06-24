import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { SheetsService } from '../../sheets/sheets.service';
import { RendicionesService } from '../../rendiciones/rendiciones.service';
import { runWithTenant } from '../../../common/tenant/tenant-context';

@Processor('persist')
export class PersistProcessor extends WorkerHost {
  private readonly logger = new Logger(PersistProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sheetsService: SheetsService,
    private readonly rendicionesService: RendicionesService,
  ) {
    super();
  }

  async process(job: Job<{ evento_crudo_id: string; client_id: string; classification: any; processing_status: string }>): Promise<void> {
    const { evento_crudo_id, client_id } = job.data;
    try {
      // Fase 2 — happy path dentro de una tx con app.current_tenant = client_id.
      await runWithTenant(this.dataSource, client_id, () => this.persistEvento(job));
    } catch (err: any) {
      this.logger.error(`[F1Persist] Error: ${err.message}`);
      // setStatus de error en tx SEPARADA: persiste pese al rollback del happy path.
      await runWithTenant(this.dataSource, client_id, () =>
        this.dataSource.query(
          `UPDATE eventos_crudos SET processing_status_new='failed_classification', status='failed', error_message=$1 WHERE id=$2`,
          [err.message, evento_crudo_id],
        ),
      ).catch(() => {});
      throw err;
    }
  }

  private async persistEvento(
    job: Job<{ evento_crudo_id: string; client_id: string; classification: any; processing_status: string }>,
  ): Promise<void> {
    const { evento_crudo_id, client_id, classification } = job.data;
    this.logger.log(`[F1Persist] Persisting evento: ${evento_crudo_id}`);

    const datos     = classification.datos_extraidos ?? {};
    const tipo      = classification.tipo;
    const destino   = classification.destino;
    const confidence = classification.confidence_score ?? 0;

    const eventoRows = await this.dataSource.query(
      `SELECT payload, canal, source, email_from FROM eventos_crudos WHERE id=$1`, [evento_crudo_id],
    );
    if (!eventoRows.length) throw new Error('Evento not found');
    const { canal, source: eventoSource, payload, email_from } = eventoRows[0];
    // WhatsApp guarda el canal en la columna `source` (no `canal`). `invoices.source`
    // es NOT NULL → fallback para no romper el INSERT con un canal null.
    const channel = canal ?? eventoSource ?? 'unknown';

    const category    = destino === 'gastos' ? 'expense' : destino === 'ventas' ? 'sale' : 'cost';
    const amount      = datos.monto_total ?? 0;
    const vendorName  = datos.razon_social_emisor ?? 'Unknown';
    const invoiceDate = datos.fecha_emision ?? new Date().toISOString().split('T')[0];
    const description = `${tipo} - ${classification.categoria ?? 'Sin categoría'} | Confidence: ${confidence}`;

    // Natural key duplicate check
    if (datos.numero_documento && datos.rut_emisor) {
      const dupInvoice = await this.dataSource.query(
        `SELECT id FROM invoices WHERE client_id=$1 AND numero_documento=$2 AND rut_emisor=$3 LIMIT 1`,
        [client_id, datos.numero_documento, datos.rut_emisor],
      );
      if (dupInvoice.length) {
        await this.dataSource.query(
          `UPDATE eventos_crudos SET processing_status_new='duplicate', status='duplicate' WHERE id=$1`,
          [evento_crudo_id],
        );
        this.logger.warn(`[F1Persist] Duplicate invoice: ${evento_crudo_id}`);
        return;
      }
    }

    const invoiceResult = await this.dataSource.query(
      `INSERT INTO invoices (
        client_id, source, vendor_name, amount, currency,
        invoice_date, category, description, status,
        raw_payload, ai_extracted
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id`,
      [
        client_id, channel, vendorName, amount, datos.moneda ?? 'CLP',
        invoiceDate, category, description, 'pending',
        JSON.stringify(classification), JSON.stringify(classification),
      ],
    );

    const invoiceId = invoiceResult[0].id;

    await this.dataSource.query(
      `UPDATE eventos_crudos SET factura_id=$1, processing_status_new='processed', status='processed', processed_at=NOW() WHERE id=$2`,
      [invoiceId, evento_crudo_id],
    );

    this.logger.log(`[F1Persist] Invoice created: ${invoiceId} from evento: ${evento_crudo_id}`);

    // ─── f2-rendicion: agrupar gasto en rendición semanal ─────────────────
    if (category === 'expense') {
      try {
        const projectId = classification.proyecto_id_sugerido
          ?? (typeof payload === 'object' ? payload?.project_id : null)
          ?? null;
        const personaId = await this.resolvePersonaId(client_id, payload, channel);
        if (personaId) {
          await this.rendicionesService.asignarFacturaARendicion(
            client_id, invoiceId, personaId, projectId, amount, invoiceDate,
          );
        }
      } catch (err: any) {
        this.logger.warn(`[F1Persist] F2 rendición assignment failed: ${err.message}`);
      }
    }

    // ─── f1-sheets-export ─────────────────────────────────────────────────
    await this.sheetsService.exportInvoice(client_id, {
      id: invoiceId,
      vendor_name: vendorName,
      amount,
      currency: datos.moneda ?? 'CLP',
      invoice_date: invoiceDate,
      category,
      description,
      source: channel,
      confidence_score: confidence,
      ai_classification: classification,
    });

    // ─── f1-notify: email reply to sender ────────────────────────────────
    await this.sendNotification({
      canal,
      emailFrom: email_from ?? (typeof payload === 'object' ? payload?.from : null),
      amount,
      currency: datos.moneda ?? 'CLP',
      destino,
      categoria: classification.categoria ?? 'Sin categoría',
      vendorName,
    });
  }

  private async resolvePersonaId(
    clientId: string,
    payload: any,
    canal: string,
  ): Promise<string | null> {
    const phone = typeof payload === 'object' ? (payload?.from ?? payload?.phone) : null;
    const email = typeof payload === 'object' ? payload?.email_from : null;

    if (phone) {
      const rows = await this.dataSource.query(
        `SELECT id FROM promoters WHERE client_id = $1 AND phone = $2 LIMIT 1`,
        [clientId, phone],
      ).catch(() => []);
      if (rows.length) return rows[0].id;
    }

    if (email) {
      const rows = await this.dataSource.query(
        `SELECT id FROM users WHERE client_id = $1 AND email = $2 LIMIT 1`,
        [clientId, email],
      ).catch(() => []);
      if (rows.length) return rows[0].id;
    }

    if (canal === 'whatsapp' && phone) {
      const rows = await this.dataSource.query(
        `SELECT id FROM collaborators WHERE client_id = $1 AND phone = $2 LIMIT 1`,
        [clientId, phone],
      ).catch(() => []);
      if (rows.length) return rows[0].id;
    }

    this.logger.warn(`[F1Persist] Could not resolve persona_id for canal=${canal}`);
    return null;
  }

  private async sendNotification(opts: {
    canal: string;
    emailFrom: string | null;
    amount: number;
    currency: string;
    destino: string;
    categoria: string;
    vendorName: string;
  }): Promise<void> {
    try {
      if (opts.canal !== 'email' || !opts.emailFrom) return;

      const amountFormatted = new Intl.NumberFormat('es-CL', {
        style: 'currency', currency: opts.currency, maximumFractionDigits: 0,
      }).format(Number(opts.amount));

      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        this.logger.log(`[F1Notify] No RESEND_API_KEY — skipping email reply to ${opts.emailFrom}`);
        return;
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: 'Control Suite <noreply@controlsuite.cl>',
          to: [opts.emailFrom],
          subject: 'Documento recibido y registrado · Control Suite',
          text: `Hola,\n\nTu documento fue procesado exitosamente.\n\nProveedor: ${opts.vendorName}\nMonto: ${amountFormatted}\nDestino: ${opts.destino} · ${opts.categoria}\n\n---\nControl Suite · Operations Platform`,
        }),
      });

      if (res.ok) {
        this.logger.log(`[F1Notify] Email reply sent to: ${opts.emailFrom}`);
      } else {
        const err = await res.json();
        this.logger.warn(`[F1Notify] Resend error: ${JSON.stringify(err)}`);
      }
    } catch (err: any) {
      this.logger.warn(`[F1Notify] Failed: ${err.message}`);
    }
  }
}
