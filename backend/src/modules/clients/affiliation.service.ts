import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { runWithTenant } from '../../common/tenant/tenant-context';

export interface AffiliationResult {
  promoterId: string;
  created: boolean;
}

/**
 * Affiliation action for the single-global-number model (Camino 2): a valid code
 * makes the sender an ACTIVE promoter of the agency immediately — no approval step.
 *
 * The write runs under `runWithTenant` so `app.current_tenant` is set and the INSERT
 * satisfies the RLS WITH CHECK (client_id = current tenant). Idempotent AND race-safe:
 * an existing active promoter for the same phone is reused, never duplicated. Two
 * concurrent affiliations of the same phone cannot both insert — a UNIQUE partial index
 * on (client_id, normalized phone) WHERE status='active' (migration 1700000000067)
 * backs the ON CONFLICT DO NOTHING, and a lost race re-SELECTs the winner's row.
 */
@Injectable()
export class AffiliationService {
  private readonly logger = new Logger(AffiliationService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async affiliate(clientId: string, phone: string, name?: string): Promise<AffiliationResult> {
    const digits = normalizePhone(phone);
    const label = name?.trim() || `Afiliado ${digits}`;

    return runWithTenant(this.ds, clientId, async () => {
      const existing = await this.findActivePromoterId(clientId, digits);
      if (existing) {
        return { promoterId: existing, created: false };
      }

      // promoters carries BOTH is_active (legacy boolean) and status (enum); the
      // WhatsApp sender gate filters on status='active', so set both. The ON CONFLICT
      // target is the UNIQUE partial index on the NORMALIZED phone (migration 67), so a
      // concurrent affiliation of the same phone inserts nothing and returns no row.
      const inserted = await this.ds.query(
        `INSERT INTO promoters
           (client_id, name, phone, status, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', true, NOW(), NOW())
         ON CONFLICT (client_id, regexp_replace(phone, '\\D', '', 'g'))
           WHERE status = 'active'
           DO NOTHING
         RETURNING id`,
        [clientId, label, phone],
      );

      const promoterId = inserted?.[0]?.id;
      if (promoterId) {
        this.logger.log(`[Affiliation] promoter affiliated [clientId=${clientId}, promoterId=${promoterId}]`);
        return { promoterId, created: true };
      }

      // Lost the race (ON CONFLICT DID NOTHING): the concurrent winner's row exists now.
      const winner = await this.findActivePromoterId(clientId, digits);
      if (winner) {
        return { promoterId: winner, created: false };
      }
      // Extremely unlikely (conflict but no matching active row) — surface it, don't
      // silently return a bogus success.
      throw new Error(`[Affiliation] affiliate: conflict but no active promoter resolvable [clientId=${clientId}]`);
    });
  }

  /** Active promoter id for this client matching the phone by digits, or null. */
  private async findActivePromoterId(clientId: string, digits: string): Promise<string | null> {
    const rows = await this.ds.query(
      `SELECT id FROM promoters
        WHERE client_id = $1
          AND status = 'active'
          AND phone IS NOT NULL
          AND regexp_replace(phone, '\\D', '', 'g') = $2
        LIMIT 1`,
      [clientId, digits],
    );
    return rows?.[0]?.id ?? null;
  }
}
