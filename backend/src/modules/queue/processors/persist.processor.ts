import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { SheetsService } from '../../sheets/sheets.service';

@Processor('persist')
export class PersistProcessor extends WorkerHost {
  private readonly logger = new Logger(PersistProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sheetsService: SheetsService,
  ) {
    super();
  }

  async process(job: Job<{ evento_crudo_id: string; client_id: string; classification: any; processing_status: string }>): Promise<void> {
    const { evento_crudo_id, client_id, classification, processing_status } = job.data;
    this.logger.log(`[F1Persist] Persisting evento: ${evento_crudo_id}`);

    try {
      const datos     = classification.datos_extraidos ?? {};
      const tipo      = classification.tipo;
      const destino   = classification.destino;
      const confidence = classification.confidence_score ?? 0;

      const eventoRows = await this.dataSource.query(
        `SELECT payload, canal, email_from FROM eventos_crudos WHERE id=$1`, [evento_crudo_id],
      );
      if (!eventoRows.length) throw new Error('Evento not found');
      const { canal, payload, email_from } = eventoRows[0];

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
          client_id, canal, vendorName, amount, datos.moneda ?? 'CLP',
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

      // ─── f1-sheets-export ─────────────────────────────────────────────────
      await this.sheetsService.exportInvoice(client_id, {
        id: invoiceId,
        vendor_name: vendorName,
        amount,
        currency: datos.moneda ?? 'CLP',
        invoice_date: invoiceDate,
        category,
        description,
        source: canal,
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

    } catch (err: any) {
      this.logger.error(`[F1Persist] Error: ${err.message}`);
      await this.dataSource.query(
        `UPDATE eventos_crudos SET processing_status_new='failed_classification', status='failed', error_message=$1 WHERE id=$2`,
        [err.message, evento_crudo_id],
      );
      throw err;
    }
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