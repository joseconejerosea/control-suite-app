import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

export interface F1DocumentFilters {
  project_id?: string;
  tipo?: string;
  status?: string;
  confidence_min?: number;
  confidence_max?: number;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class F1ReviewService {
  private readonly logger = new Logger(F1ReviewService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly wa: WhatsAppService,
  ) {}

  async findAll(clientId: string, filters: F1DocumentFilters) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    const conditions: string[] = ['ec.client_id = $1', "ec.flow = 'F1'"];
    const params: any[] = [clientId];
    let paramIdx = 2;

    if (filters.project_id) {
      conditions.push(`ec.payload->>'project_id' = $${paramIdx++}`);
      params.push(filters.project_id);
    }
    if (filters.tipo) {
      conditions.push(`ec.ai_classification->>'tipo' = $${paramIdx++}`);
      params.push(filters.tipo);
    }
    if (filters.status) {
      conditions.push(`ec.status = $${paramIdx++}`);
      params.push(filters.status);
    }
    if (filters.confidence_min != null) {
      conditions.push(`ec.confidence_score >= $${paramIdx++}`);
      params.push(filters.confidence_min);
    }
    if (filters.confidence_max != null) {
      conditions.push(`ec.confidence_score <= $${paramIdx++}`);
      params.push(filters.confidence_max);
    }
    if (filters.date_from) {
      conditions.push(`ec.created_at >= $${paramIdx++}`);
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push(`ec.created_at <= $${paramIdx++}`);
      params.push(filters.date_to);
    }

    const where = conditions.join(' AND ');

    const [rows, countResult] = await Promise.all([
      this.ds.query(
        `SELECT
          ec.id,
          ec.status,
          ec.source,
          ec.flow,
          ec.confidence_score,
          ec.ai_classification,
          ec.payload,
          ec.parsed_data,
          ec.created_at,
          ec.updated_at,
          p.name AS project_name
        FROM eventos_crudos ec
        LEFT JOIN projects p ON p.id::text = ec.payload->>'project_id'
        WHERE ${where}
        ORDER BY ec.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset],
      ),
      this.ds.query(
        `SELECT COUNT(*)::int AS total FROM eventos_crudos ec WHERE ${where}`,
        params,
      ),
    ]);

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: countResult[0]?.total ?? 0,
        pages: Math.ceil((countResult[0]?.total ?? 0) / limit),
      },
    };
  }

  async findOne(clientId: string, id: string) {
    const rows = await this.ds.query(
      `SELECT
        ec.*,
        p.name AS project_name
      FROM eventos_crudos ec
      LEFT JOIN projects p ON p.id::text = ec.payload->>'project_id'
      WHERE ec.id = $1 AND ec.client_id = $2 AND ec.flow = 'F1'`,
      [id, clientId],
    );

    if (!rows.length) throw new NotFoundException('Document not found');

    const doc = rows[0];

    // Generate signed URL for the original file
    let signedUrl: string | null = null;
    const storagePath = doc.payload?.storage_path;
    if (storagePath) {
      try {
        signedUrl = await this.storage.getSignedUrl(storagePath, 3600);
      } catch {
        this.logger.warn(`[F1Review] Could not get signed URL for ${storagePath}`);
      }
    }

    return {
      ...doc,
      signed_url: signedUrl,
    };
  }

  async approve(
    clientId: string,
    id: string,
    userId: string,
    ip: string,
  ) {
    const doc = await this.getDocOrFail(clientId, id);

    await this.ds.query(
      `UPDATE eventos_crudos SET
        status = 'approved',
        parsed_data = COALESCE(parsed_data, '{}'::jsonb) || $1::jsonb,
        updated_at = NOW()
      WHERE id = $2 AND client_id = $3`,
      [
        JSON.stringify({
          approved_by: userId,
          approved_at: new Date().toISOString(),
        }),
        id,
        clientId,
      ],
    );

    await this.audit.log({
      tenantId: clientId,
      userId,
      action: 'APPROVE_DOCUMENT',
      entity: 'eventos_crudos',
      entityId: id,
      metadata: {
        tipo: doc.ai_classification?.tipo,
        confidence: doc.confidence_score,
      },
      ip,
    });

    return { message: 'Document approved', id };
  }

  async reject(
    clientId: string,
    id: string,
    userId: string,
    reason: string,
    ip: string,
  ) {
    const doc = await this.getDocOrFail(clientId, id);

    await this.ds.query(
      `UPDATE eventos_crudos SET
        status = 'rejected',
        parsed_data = COALESCE(parsed_data, '{}'::jsonb) || $1::jsonb,
        updated_at = NOW()
      WHERE id = $2 AND client_id = $3`,
      [
        JSON.stringify({
          rejected_by: userId,
          rejected_at: new Date().toISOString(),
          rejection_reason: reason,
        }),
        id,
        clientId,
      ],
    );

    await this.audit.log({
      tenantId: clientId,
      userId,
      action: 'REJECT_DOCUMENT',
      entity: 'eventos_crudos',
      entityId: id,
      metadata: {
        tipo: doc.ai_classification?.tipo,
        reason,
      },
      ip,
    });

    // Notify supervisor via WhatsApp
    const phone = doc.payload?.from;
    if (phone) {
      const lang = await this.getUserLanguage(clientId);
      const msg = lang === 'en'
        ? `Your document was rejected.\nReason: ${reason}\nPlease resend the correct document.`
        : `Tu documento fue rechazado.\nMotivo: ${reason}\nPor favor reenvía el documento correcto.`;
      await this.wa.sendText(phone, msg);
    }

    return { message: 'Document rejected', id };
  }

  private async getDocOrFail(clientId: string, id: string): Promise<any> {
    const rows = await this.ds.query(
      `SELECT * FROM eventos_crudos WHERE id = $1 AND client_id = $2 AND flow = 'F1'`,
      [id, clientId],
    );
    if (!rows.length) throw new NotFoundException('Document not found');
    return rows[0];
  }

  private async getUserLanguage(clientId: string): Promise<string> {
    const rows = await this.ds.query(
      `SELECT language FROM users WHERE client_id = $1 AND role = 'admin_cliente' LIMIT 1`,
      [clientId],
    ).catch(() => []);
    return rows[0]?.language ?? 'es';
  }
}
