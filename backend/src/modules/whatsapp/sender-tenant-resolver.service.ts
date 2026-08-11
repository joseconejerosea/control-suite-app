import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { UserRole } from '../../common/enums/user-role.enum';
import { runAsSystem } from '../../common/tenant/tenant-context';

/** A client the sender is a registered actor of (candidate tenant for a flow). */
export interface ClientCandidate {
  clientId: string;
  clientName: string;
}

/**
 * Single-global-number model: the WhatsApp bot receives every tenant's messages
 * on ONE Meta number, so the tenant can no longer be derived from the recipient
 * `phone_number_id`. Instead we resolve it from the SENDER: the clients where the
 * sender's phone is a registered actor (active promoter, active collaborator, or a
 * staff user — Manager/Operator/Supervisor).
 *
 * Cardinality drives the flow: 0 → unregistered (affiliation code); 1+ → ALWAYS ask
 * which agency (a sender may also operate for a new agency, so 1 candidate is never
 * auto-selected).
 *
 * The lookup is cross-tenant discovery BEFORE the tenant is known, so it runs under
 * `runAsSystem` (BYPASSRLS system pool) — the same pattern the crons use. This is
 * future-proof once the runtime role drops BYPASSRLS (RLS Phase 2 · E6).
 */
@Injectable()
export class SenderTenantResolverService {
  private readonly logger = new Logger(SenderTenantResolverService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async candidatesFor(from: string): Promise<ClientCandidate[]> {
    const digits = normalizePhone(from);
    if (!digits) return [];

    try {
      const rows = await runAsSystem(() =>
        this.ds.query(
          `SELECT DISTINCT c.id AS "clientId", c.nombre AS "clientName"
             FROM clients c
            WHERE c.id IN (
              SELECT client_id FROM promoters
                WHERE status = 'active'
                  AND phone IS NOT NULL
                  AND regexp_replace(phone, '\\D', '', 'g') = $1
              UNION
              SELECT client_id FROM collaborators
                WHERE is_active = true
                  AND phone IS NOT NULL
                  AND regexp_replace(phone, '\\D', '', 'g') = $1
              UNION
              SELECT client_id FROM users
                WHERE is_active = true
                  AND role IN ($2, $3, $4)
                  AND phone IS NOT NULL
                  AND regexp_replace(phone, '\\D', '', 'g') = $1
            )
            ORDER BY c.nombre`,
          [digits, UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERVISOR],
        ),
      );

      return (rows as ClientCandidate[]).map((r) => ({
        clientId: r.clientId,
        clientName: r.clientName,
      }));
    } catch (err: any) {
      // A DB error is NOT a genuine 0-candidates result. Returning [] here would route
      // the sender to the affiliation-code path ("you're unregistered"), leaking a
      // transient failure as a wrong answer. Re-throw so the controller can tell the
      // sender to retry — fail-closed still holds (no tenant is ever selected on error).
      this.logger.error(`[WhatsApp] candidatesFor error from=${from}: ${err.message}`);
      throw err;
    }
  }
}
