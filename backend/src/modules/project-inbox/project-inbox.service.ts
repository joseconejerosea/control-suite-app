import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProjectInboxService {
  private readonly logger = new Logger(ProjectInboxService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  async findAll(tenantId: string) {
    return this.ds.query(
      `SELECT pi.*,
              p.name as project_name
       FROM project_inbox pi
       LEFT JOIN projects p ON p.id = pi.project_id
       WHERE pi.tenant_id = $1
       ORDER BY pi.created_at DESC`,
      [tenantId],
    );
  }

  async findOne(tenantId: string, id: string) {
    const rows = await this.ds.query(
      `SELECT pi.*,
              p.name as project_name
       FROM project_inbox pi
       LEFT JOIN projects p ON p.id = pi.project_id
       WHERE pi.id = $1 AND pi.tenant_id = $2`,
      [id, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Inbox item not found');
    return rows[0];
  }

  async createFromUpload(
    tenantId: string,
    source: string,
    rawContent: Record<string, unknown>,
  ) {
    const res = await this.ds.query(
      `INSERT INTO project_inbox (tenant_id, source, raw_content, status)
       VALUES ($1, $2, $3::jsonb, 'PENDING')
       RETURNING *`,
      [tenantId, source, JSON.stringify(rawContent)],
    );
    return res[0];
  }

  async approve(
    tenantId: string,
    id: string,
    userId: string,
    overrides: Record<string, unknown>,
    ip: string,
  ) {
    const item = await this.findOne(tenantId, id);
    if (item.status === 'APPROVED')
      throw new BadRequestException('Already approved');
    if (item.status !== 'READY' && item.status !== 'PENDING')
      throw new BadRequestException(`Cannot approve item with status ${item.status}`);

    const extracted = {
      ...(typeof item.extracted_data === 'string'
        ? JSON.parse(item.extracted_data)
        : item.extracted_data ?? {}),
      ...overrides,
    };

    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    // Fase 2 — este QueryRunner manual no pasa por el patch del ds: setear el GUC acá.
    await qr.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    try {
      const projRes = await qr.query(
        `INSERT INTO projects
           (client_id, name, description, status, start_date, end_date, budget, config)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7::jsonb)
         RETURNING id`,
        [
          tenantId,
          extracted.nombre_proyecto ?? 'Proyecto sin nombre',
          extracted.brief ?? null,
          extracted.fecha_inicio ?? null,
          extracted.fecha_fin ?? null,
          extracted.presupuesto_otorgado ?? null,
          JSON.stringify({
            ia_extracted: extracted,
            source: item.source,
            inbox_id: id,
          }),
        ],
      );
      const projectId = projRes[0].id;

      if (extracted.locales?.length) {
        for (const local of extracted.locales) {
          await qr.query(
            `INSERT INTO locations (client_id, name, address)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [tenantId, local.nombre, local.direccion],
          ).catch(() => {});
        }
      }

      await qr.query(
        `UPDATE project_inbox
         SET status = 'APPROVED', project_id = $2, reviewed_by = $3, reviewed_at = NOW()
         WHERE id = $1`,
        [id, projectId, userId],
      );

      await qr.commitTransaction();

      await this.audit.log({
        tenantId, userId, action: 'APPROVE_INBOX', entity: 'project_inbox',
        entityId: id, metadata: { project_id: projectId }, ip,
      });

      this.logger.log(`[ProjectInbox] Approved ${id} → project ${projectId}`);
      return { project_id: projectId };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async reject(
    tenantId: string,
    id: string,
    userId: string,
    reason: string,
    ip: string,
  ) {
    const item = await this.findOne(tenantId, id);
    if (item.status === 'REJECTED')
      throw new BadRequestException('Already rejected');

    await this.ds.query(
      `UPDATE project_inbox
       SET status = 'REJECTED', reviewed_by = $2, reviewed_at = NOW(),
           conflicts = jsonb_set(COALESCE(conflicts, '{}'), '{rejection_reason}', $3::jsonb)
       WHERE id = $1 AND tenant_id = $4`,
      [id, userId, JSON.stringify(reason), tenantId],
    );

    await this.audit.log({
      tenantId, userId, action: 'REJECT_INBOX', entity: 'project_inbox',
      entityId: id, metadata: { reason }, ip,
    });
  }
}
