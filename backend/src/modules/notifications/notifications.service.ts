import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { UserRole } from '../../common/enums/user-role.enum';

export interface NotifyPayload {
  type: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface ListResult {
  data: any[];
  unreadCount: number;
}

/**
 * Generic in-app notifications service.
 *
 * Each call to notifyUsers creates one row per recipient in the notifications
 * table. read_at is per-user, enforced via user_id predicates (NOT RLS) because
 * the notifications table RLS is scoped by client_id only.
 *
 * Writes from the WhatsApp @Public path have no tenant context: callers must
 * wrap in runWithTenant. Controller path: the global TenantInterceptor handles it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Inserts one notification row per userId.
   * Empty array → no-op (0 rows inserted, no exception).
   */
  async notifyUsers(
    clientId: string,
    userIds: string[],
    payload: NotifyPayload,
  ): Promise<void> {
    if (!userIds.length) return;

    // All-or-nothing broadcast: a SINGLE multi-row INSERT inside ONE
    // runWithTenant tx. A per-user loop would open one tx per recipient, so a
    // partial failure could leave some rows committed (non-atomic broadcast).
    // Shared payload columns are passed once ($1..$5); each user_id gets its own
    // placeholder appended to the VALUES list → N users → N rows in one statement.
    const type = payload.type;
    const title = payload.title;
    const body = payload.body ?? null;
    const metadata = payload.metadata ? JSON.stringify(payload.metadata) : null;

    const sharedParams: unknown[] = [clientId, type, title, body, metadata];
    // user_ids occupy $6, $7, … after the 5 shared params.
    const valuesList = userIds
      .map(
        (_userId, i) => `($1, $${sharedParams.length + 1 + i}, $2, $3, $4, $5)`,
      )
      .join(', ');
    const params: unknown[] = [...sharedParams, ...userIds];

    await runWithTenant(this.ds, clientId, () =>
      this.ds.query(
        `INSERT INTO notifications (client_id, user_id, type, title, body, metadata)
         VALUES ${valuesList}`,
        params,
      ),
    );
  }

  /**
   * Lists notifications for a specific user within a tenant.
   * Returns the rows plus the total unread count (always, regardless of unreadOnly).
   * Ordered by created_at DESC, limited to 50.
   */
  async listForUser(
    clientId: string,
    userId: string,
    unreadOnly: boolean,
  ): Promise<ListResult> {
    const unreadFilter = unreadOnly ? 'AND read_at IS NULL' : '';

    const [rows, countRows] = await Promise.all([
      this.ds.query(
        `SELECT id, user_id, type, title, body, metadata, read_at, created_at
           FROM notifications
          WHERE client_id = $1 AND user_id = $2 ${unreadFilter}
          ORDER BY created_at DESC
          LIMIT 50`,
        [clientId, userId],
      ),
      this.ds.query(
        `SELECT COUNT(*)::int AS count
           FROM notifications
          WHERE client_id = $1 AND user_id = $2 AND read_at IS NULL`,
        [clientId, userId],
      ),
    ]);

    return {
      data: rows,
      unreadCount: Number(countRows[0]?.count ?? 0),
    };
  }

  /**
   * Marks a single notification read.
   * user_id predicate enforces own-only: 0 rows updated → NotFoundException.
   * Idempotent: already-read row still matches the UPDATE → 1 row affected.
   */
  async markRead(clientId: string, userId: string, id: string): Promise<void> {
    const result = await this.ds.query(
      `UPDATE notifications
          SET read_at = now()
        WHERE id = $1 AND user_id = $2 AND client_id = $3
        RETURNING id`,
      [id, userId, clientId],
    );

    // TypeORM's query() for an UPDATE ... RETURNING returns `[rows, affectedCount]`
    // (e.g. 0 matched → `[[], 0]`, which is length 2 — NOT a flat rows array).
    // Normalize so 0-row detection is correct regardless of driver/route/mock shape.
    const updatedRows = Array.isArray(result?.[0]) ? result[0] : result;

    if (!updatedRows?.length) {
      throw new NotFoundException(
        'Notification not found or does not belong to the current user',
      );
    }
  }

  /**
   * Marks all unread notifications read for the authenticated user.
   * Idempotent: zero unread → 0 rows updated, no error.
   */
  async markAllRead(clientId: string, userId: string): Promise<void> {
    await this.ds.query(
      `UPDATE notifications
          SET read_at = now()
        WHERE client_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [clientId, userId],
    );
  }

  /**
   * Returns the user IDs of all admin_cliente users in the tenant.
   * Mirrors OperatorNotifierService.getAdminPhones but returns id instead of phone.
   * users table is outside RLS; no runWithTenant needed.
   */
  async resolveManagerIds(clientId: string): Promise<string[]> {
    try {
      const rows: { id: string }[] = await this.ds.query(
        `SELECT id FROM users WHERE client_id = $1 AND role = '${UserRole.MANAGER}'`,
        [clientId],
      );
      return rows.map((r) => r.id);
    } catch (err) {
      // Do NOT swallow: a failed query masquerading as "zero managers" would
      // silently drop the alert. Log and rethrow so the caller can react.
      this.logger.error(
        `Failed to resolve manager ids for tenant=${clientId}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }
}
