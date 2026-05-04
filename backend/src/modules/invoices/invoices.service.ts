import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Invoice, InvoiceCategory, InvoiceSource } from './invoice.entity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

const QUEUE_OCR = 'ocr';
const F1_MAX_FILE_SIZE = 10 * 1024 * 1024;

export interface ReportSummary {
  total_amount: number;
  total_count: number;
  by_category: Array<{ category: string; total: number; count: number }>;
  rows: Array<{
    id: string;
    vendor_name: string | null;
    amount: number | null;
    currency: string;
    invoice_date: string | null;
    category: string;
    source: string;
    description: string | null;
    status: string;
    created_at: string;
  }>;
}

export interface AiInvoicePayload {
  vendor_name?: string;
  amount?: number;
  currency?: string;
  invoice_date?: string;
  category?: InvoiceCategory;
  description?: string;
}

export interface F1IngestResult {
  evento_crudo_id: string;
  status: 'queued' | 'duplicate' | 'rejected';
  message: string;
}

const VALID_CATEGORIES = ['sale', 'cost', 'expense'];

const IMAGE_EXTRACTION_PROMPT = `You are a receipt and invoice data extraction assistant.
Extract ANY financial information from this image — even if blurry, crumpled, rotated, or partially visible.

RULES:
- Output ONLY valid JSON, nothing else
- ALWAYS try to extract something — partial data is useful
- category MUST be exactly one of: "sale", "cost", "expense"
- Only return is_invoice: false if image is completely unreadable or clearly not a receipt

Output format:
{
  "is_invoice": true,
  "vendor_name": "store or company name, or null",
  "amount": total amount as number or null,
  "currency": "CLP",
  "invoice_date": "YYYY-MM-DD or null",
  "category": "cost",
  "description": "brief description of what you see"
}`;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly repo: TenantRepository<Invoice>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(QUEUE_OCR) private readonly ocrQueue: Queue,
  ) {
    this.repo = new TenantRepository<Invoice>(dataSource, Invoice);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INGEST
  // ═══════════════════════════════════════════════════════════════════════════

  async f1IngestManual(
    clientId: string,
    userId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    formTarget: 'gastos' | 'ventas' | 'costos' = 'gastos',
    notes?: string,
  ): Promise<{ data: F1IngestResult }> {
    if (file.size > F1_MAX_FILE_SIZE) throw new BadRequestException('File too large. Max 10MB.');
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) throw new BadRequestException(`Invalid file type: ${file.mimetype}`);

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

    const dup = await this.dataSource.query(
      `SELECT id FROM eventos_crudos WHERE client_id=$1 AND doc_sha256=$2 AND processing_status_new='processed' LIMIT 1`,
      [clientId, sha256],
    );
    if (dup.length) return { evento_crudo_id: dup[0].id, status: 'duplicate', message: `Duplicate: ${dup[0].id}` } as any;

    const docKey = `clients/${clientId}/manual/${Date.now()}_${file.originalname}`;
    const rawPayload = {
      form_target: formTarget,
      notes: notes ?? null,
      user_id: userId,
      original_filename: file.originalname,
      file_base64: file.buffer.toString('base64'),
      mime_type: file.mimetype,
    };

    const result = await this.dataSource.query(
      `INSERT INTO eventos_crudos (
        client_id, canal, doc_key, doc_mime_type, doc_size_bytes,
        doc_sha256, processing_status_new, payload, source
      ) VALUES ($1,'manual',$2,$3,$4,$5,'queued',$6,'manual')
      RETURNING id`,
      [clientId, docKey, file.mimetype, file.size, sha256, JSON.stringify(rawPayload)],
    );

    const eventoId = result[0].id;
    await this.ocrQueue.add(
      'ocr',
      { evento_crudo_id: eventoId, client_id: clientId, canal: 'manual' },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    this.logger.log(`[Ingest] Manual upload queued: ${eventoId}`);
    return { evento_crudo_id: eventoId, status: 'queued', message: 'Document queued for processing.' } as any;
  }

  async f1IngestEmail(
    clientId: string,
    emailFrom: string,
    subject: string,
    gmailId: string,
    imageBase64: string,
    mimeType: string,
    fileSize: number,
  ): Promise<F1IngestResult> {
    const buffer = Buffer.from(imageBase64, 'base64');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const dup = await this.dataSource.query(
      `SELECT id FROM eventos_crudos WHERE client_id=$1 AND doc_sha256=$2 AND processing_status_new='processed' LIMIT 1`,
      [clientId, sha256],
    );
    if (dup.length) return { evento_crudo_id: dup[0].id, status: 'duplicate', message: `Duplicate: ${dup[0].id}` };

    const docKey = `clients/${clientId}/email/${Date.now()}_attachment`;
    const rawPayload = { subject, email_from: emailFrom, gmail_id: gmailId, file_base64: imageBase64, mime_type: mimeType };

    const result = await this.dataSource.query(
      `INSERT INTO eventos_crudos (
        client_id, canal, email_from, doc_key, doc_mime_type,
        doc_size_bytes, doc_sha256, processing_status_new, payload, source
      ) VALUES ($1,'email',$2,$3,$4,$5,$6,'queued',$7,'email')
      RETURNING id`,
      [clientId, emailFrom, docKey, mimeType, fileSize, sha256, JSON.stringify(rawPayload)],
    );

    const eventoId = result[0].id;
    await this.ocrQueue.add(
      'ocr',
      { evento_crudo_id: eventoId, client_id: clientId, canal: 'email' },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    this.logger.log(`[Ingest] Email queued: ${eventoId}`);
    return { evento_crudo_id: eventoId, status: 'queued', message: 'Email document queued.' };
  }

  async f1GetStatus(eventoId: string, clientId: string): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT id, canal, processing_status_new as status, confidence_score,
              ai_classification, created_at, processed_at, error_message, factura_id
       FROM eventos_crudos WHERE id=$1 AND client_id=$2`,
      [eventoId, clientId],
    );
    if (!rows.length) throw new BadRequestException('Evento not found');
    const e = rows[0];
    return {
      data: {
        ...e,
        pipeline_stages: [
          { name: 'upload',         label: 'Recepción',       status: 'completed',                              completed_at: e.created_at },
          { name: 'ocr',            label: 'OCR',             status: this.stageStatus(e.status, 'ocr') },
          { name: 'classification', label: 'Clasificación IA',status: this.stageStatus(e.status, 'classification'), confidence: e.confidence_score },
          { name: 'persist',        label: 'Persistencia',    status: this.stageStatus(e.status, 'persist'),    factura_id: e.factura_id, completed_at: e.processed_at },
        ],
      },
    };
  }

  async f1ListEventos(clientId: string): Promise<any[]> {
    return this.dataSource.query(
      `SELECT id, canal, processing_status_new as status, confidence_score,
              ai_classification, created_at, processed_at, error_message
       FROM eventos_crudos WHERE client_id=$1
       ORDER BY created_at DESC LIMIT 50`,
      [clientId],
    );
  }

  async f1Reprocess(eventoId: string, clientId: string, userId: string): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT id, processing_status_new FROM eventos_crudos WHERE id=$1 AND client_id=$2`,
      [eventoId, clientId],
    );
    if (!rows.length) throw new BadRequestException('Evento not found');

    await this.dataSource.query(
      `INSERT INTO f1_reprocess_log (evento_crudo_id, requested_by, previous_status) VALUES ($1,$2,$3)`,
      [eventoId, userId, rows[0].processing_status_new],
    );
    await this.dataSource.query(
      `UPDATE eventos_crudos SET processing_status_new='reprocessing', status='reprocessing',
       error_message=NULL, retries=0, reprocessed_at=NOW() WHERE id=$1`,
      [eventoId],
    );
    await this.ocrQueue.add('ocr', { evento_crudo_id: eventoId, client_id: clientId, canal: 'manual' });
    return { success: true, message: 'Evento queued for reprocessing.' };
  }

  private stageStatus(currentStatus: string, stage: string): string {
    if (currentStatus === 'queued')                return stage === 'upload' ? 'completed' : 'pending';
    if (currentStatus === 'processing')            return stage === 'ocr' ? 'running' : stage === 'upload' ? 'completed' : 'pending';
    if (currentStatus === 'ocr_done')             return ['upload','ocr'].includes(stage) ? 'completed' : stage === 'classification' ? 'running' : 'pending';
    if (currentStatus === 'failed_ocr')           return stage === 'ocr' ? 'failed' : stage === 'upload' ? 'completed' : 'pending';
    if (currentStatus === 'failed_classification')return stage === 'classification' ? 'failed' : ['upload','ocr'].includes(stage) ? 'completed' : 'pending';
    if (currentStatus === 'unclassified')         return stage === 'classification' ? 'warning' : stage === 'persist' ? 'pending' : 'completed';
    if (['processed','low_confidence'].includes(currentStatus)) return 'completed';
    return 'pending';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXISTING METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  async create(clientId: string, dto: CreateInvoiceDto): Promise<Invoice> {
    return this.repo.create(clientId, {
      source:       dto.source ?? 'manual',
      vendor_name:  dto.vendor_name ?? null,
      amount:       dto.amount != null ? String(dto.amount) : null,
      currency:     dto.currency ?? 'CLP',
      invoice_date: dto.invoice_date ?? null,
      category:     dto.category,
      description:  dto.description ?? null,
      status:       dto.status ?? 'pending',
      project_id:   dto.project_id ?? null,
      raw_payload:  null,
      ai_extracted: null,
    });
  }

  async findAll(
    clientId: string,
    filters: { category?: string; source?: string; status?: string; from?: string; to?: string } = {},
  ): Promise<Invoice[]> {
    const qb = this.dataSource
      .getRepository(Invoice)
      .createQueryBuilder('i')
      .where('i.client_id = :clientId', { clientId })
      .orderBy('i.invoice_date', 'DESC')
      .addOrderBy('i.created_at', 'DESC');

    if (filters.category) qb.andWhere('i.category = :category', { category: filters.category });
    if (filters.source)   qb.andWhere('i.source = :source',     { source: filters.source });
    if (filters.status)   qb.andWhere('i.status = :status',     { status: filters.status });
    if (filters.from)     qb.andWhere('i.invoice_date >= :from', { from: filters.from });
    if (filters.to)       qb.andWhere('i.invoice_date <= :to',   { to: filters.to });

    return qb.getMany();
  }

  async findOne(clientId: string, id: string): Promise<Invoice> {
    return this.repo.findOne(clientId, id);
  }

  async update(clientId: string, id: string, dto: UpdateInvoiceDto): Promise<Invoice> {
    const existing = await this.findOne(clientId, id);
    return this.repo.update(clientId, id, {
      source:       dto.source       ?? existing.source,
      vendor_name:  dto.vendor_name  ?? existing.vendor_name,
      amount:       dto.amount != null ? String(dto.amount) : existing.amount,
      currency:     dto.currency     ?? existing.currency,
      invoice_date: dto.invoice_date ?? existing.invoice_date,
      category:     dto.category     ?? existing.category,
      description:  dto.description  ?? existing.description,
      status:       dto.status       ?? existing.status,
      project_id:   dto.project_id   ?? existing.project_id,
    });
  }

  async remove(clientId: string, id: string): Promise<void> {
    await this.findOne(clientId, id);
    await this.dataSource.getRepository(Invoice).delete({ id, client_id: clientId } as any);
  }

  async extractFromImage(
    clientId: string,
    imageBase64: string,
    mimeType: string,
  ): Promise<{ extracted: AiInvoicePayload | null; invoice: Invoice | null }> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('AI not configured.');

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
              { type: 'text', text: IMAGE_EXTRACTION_PROMPT },
            ],
          }],
        }),
      });

      if (!response.ok) throw new BadRequestException('AI image processing failed');

      const data = await response.json() as any;
      const rawJson: string = data?.content?.[0]?.text ?? '';

      let aiResult: AiInvoicePayload & { is_invoice?: boolean };
      try {
        const cleaned = rawJson.replace(/```json|```/g, '').trim();
        aiResult = JSON.parse(cleaned);
      } catch {
        const invoice = await this.repo.create(clientId, {
          source: 'manual', vendor_name: null, amount: null,
          currency: 'CLP', invoice_date: new Date().toISOString().slice(0, 10),
          category: 'cost', description: 'Image uploaded — could not extract data',
          status: 'pending', project_id: null, raw_payload: null, ai_extracted: null,
        });
        return { extracted: null, invoice };
      }

      if (aiResult?.is_invoice === false) return { extracted: null, invoice: null };

      const safeCategory = VALID_CATEGORIES.includes(aiResult.category as string)
        ? aiResult.category as InvoiceCategory : 'cost';

      const invoice = await this.repo.create(clientId, {
        source: 'manual',
        vendor_name:  aiResult.vendor_name  ?? null,
        amount:       aiResult.amount != null ? String(aiResult.amount) : null,
        currency:     aiResult.currency     ?? 'CLP',
        invoice_date: aiResult.invoice_date ?? new Date().toISOString().slice(0, 10),
        category:     safeCategory,
        description:  aiResult.description  ?? null,
        status: 'pending', project_id: null, raw_payload: null,
        ai_extracted: aiResult as Record<string, unknown>,
      });

      return { extracted: aiResult, invoice };

    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Failed to process image');
    }
  }

  async getReport(
    clientId: string,
    filters: { from?: string; to?: string; project_id?: string } = {},
  ): Promise<{ sales: ReportSummary; costs: ReportSummary; expenses: ReportSummary }> {
    const [sales, costs, expenses] = await Promise.all([
      this.buildSummary(clientId, 'sale',    filters),
      this.buildSummary(clientId, 'cost',    filters),
      this.buildSummary(clientId, 'expense', filters),
    ]);
    return { sales, costs, expenses };
  }

  private async buildSummary(
    clientId: string,
    category: InvoiceCategory,
    filters: { from?: string; to?: string; project_id?: string },
  ): Promise<ReportSummary> {
    const params: any[] = [clientId, category];
    let sql = `
      SELECT id, vendor_name, amount, currency, invoice_date,
             category, source, description, status, created_at
      FROM invoices WHERE client_id = $1 AND category = $2
    `;
    if (filters.from)       { params.push(filters.from);       sql += ` AND invoice_date >= $${params.length}`; }
    if (filters.to)         { params.push(filters.to);         sql += ` AND invoice_date <= $${params.length}`; }
    if (filters.project_id) { params.push(filters.project_id); sql += ` AND project_id = $${params.length}`; }
    sql += ' ORDER BY invoice_date DESC, created_at DESC';

    const rows = await this.dataSource.query(sql, params);
    const total_amount = rows.reduce((sum: number, r: any) => sum + (parseFloat(r.amount ?? '0') || 0), 0);

    return {
      total_amount: Math.round(total_amount),
      total_count:  rows.length,
      by_category: [{ category, total: Math.round(total_amount), count: rows.length }],
      rows: rows.map((r: any) => ({
        id: r.id, vendor_name: r.vendor_name ?? null,
        amount: r.amount != null ? parseFloat(r.amount) : null,
        currency: r.currency ?? 'CLP',
        invoice_date: r.invoice_date ? String(r.invoice_date).slice(0, 10) : null,
        category: r.category, source: r.source,
        description: r.description ?? null, status: r.status,
        created_at: r.created_at ? String(r.created_at) : '',
      })),
    };
  }

  async createFromWebhook(
    clientId: string,
    source: InvoiceSource,
    aiData: AiInvoicePayload,
    rawPayload: Record<string, unknown>,
  ): Promise<Invoice> {
    const safeCategory = VALID_CATEGORIES.includes(aiData.category as string)
      ? aiData.category as InvoiceCategory : 'cost';

    return this.repo.create(clientId, {
      source,
      vendor_name:  aiData.vendor_name  ?? null,
      amount:       aiData.amount != null ? String(aiData.amount) : null,
      currency:     aiData.currency     ?? 'CLP',
      invoice_date: aiData.invoice_date ?? new Date().toISOString().slice(0, 10),
      category:     safeCategory,
      description:  aiData.description  ?? null,
      status: 'pending', project_id: null,
      raw_payload:  rawPayload,
      ai_extracted: aiData as Record<string, unknown>,
    });
  }
}