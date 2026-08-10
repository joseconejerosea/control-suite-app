import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { normalizePhone } from '../../common/utils/normalize-phone';

/**
 * Manages the roster-gap queue of unknown promoters discovered during
 * evidence intake.
 *
 * Key invariants:
 * - phone is normalized (digits only) before every upsert so ON CONFLICT
 *   correctly dedups across different raw formats of the same number.
 * - ON CONFLICT DO UPDATE never resets estado: a row already aggregado or
 *   descartado must not bounce back to pendiente on a repeated evidence send.
 * - Writes from the WhatsApp @Public path have no tenant context → every write
 *   MUST run inside runWithTenant (mirrors NotificationsService).
 * - markAgregado returns { phone } so the controller can pre-fill the promoter
 *   create form.
 * - Rows are never deleted — estado transitions are permanent history.
 */
@Injectable()
export class PendingStaffService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Creates or updates a pending_staff row for the given (clientId, phone) pair.
   * Phone is normalized to digits-only before the upsert.
   * ON CONFLICT updates motivo and contexto but does NOT touch estado.
   */
  async upsert(
    clientId: string,
    phone: string,
    motivo: string,
    contexto: Record<string, unknown>,
  ): Promise<void> {
    const normalizedPhone = normalizePhone(phone);

    await runWithTenant(this.ds, clientId, () =>
      this.ds.query(
        `INSERT INTO pending_staff (client_id, phone, motivo, contexto)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id, phone) DO UPDATE SET
           motivo   = EXCLUDED.motivo,
           contexto = EXCLUDED.contexto`,
        [clientId, normalizedPhone, motivo, JSON.stringify(contexto)],
      ),
    );
  }

  /**
   * Lists pending_staff rows for the tenant.
   * Optionally filters by estado. Always ordered by created_at DESC.
   */
  async list(
    clientId: string,
    estado?: string,
  ): Promise<Record<string, unknown>[]> {
    const estadoFilter = estado ? `AND estado = $2` : '';
    const params: unknown[] = estado ? [clientId, estado] : [clientId];

    return this.ds.query(
      `SELECT id, client_id, phone, motivo, contexto, estado, created_at
         FROM pending_staff
        WHERE client_id = $1 ${estadoFilter}
        ORDER BY created_at DESC`,
      params,
    );
  }

  /**
   * Transitions a row to estado='agregado'.
   * Returns { phone } of the updated row so the caller can pre-fill the
   * promoter create form.
   * 0 matched rows → NotFoundException (row not found or wrong tenant).
   */
  async markAgregado(clientId: string, id: string): Promise<{ phone: string }> {
    const result = await this.ds.query(
      `UPDATE pending_staff
          SET estado = 'agregado'
        WHERE id = $1 AND client_id = $2
        RETURNING id, phone`,
      [id, clientId],
    );

    // TypeORM UPDATE ... RETURNING returns [rows, affectedCount].
    // 0 matched → [[], 0] (length 2 — NOT a flat []). Normalize before length check.
    const updatedRows = Array.isArray(result?.[0]) ? result[0] : result;

    if (!updatedRows?.length) {
      throw new NotFoundException(
        'PendingStaff row not found or does not belong to this tenant',
      );
    }

    return { phone: updatedRows[0].phone };
  }

  /**
   * Transitions a row to estado='descartado'.
   * Row persists (history). 0 matched → NotFoundException.
   */
  async markDescartado(
    clientId: string,
    id: string,
  ): Promise<{ success: true }> {
    const result = await this.ds.query(
      `UPDATE pending_staff
          SET estado = 'descartado'
        WHERE id = $1 AND client_id = $2
        RETURNING id`,
      [id, clientId],
    );

    const updatedRows = Array.isArray(result?.[0]) ? result[0] : result;

    if (!updatedRows?.length) {
      throw new NotFoundException(
        'PendingStaff row not found or does not belong to this tenant',
      );
    }

    return { success: true };
  }
}
