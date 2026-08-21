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
  /** Resolved rota flag: true = rotating (still ask "¿qué agencia?"), false = non-rotating (can skip). */
  rota: boolean;
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
          // 3-table UNION with bool_or(x.rota) so that if ANY row for this sender+client
          // is rotating, the candidate is treated as rotating (conservative I-1 fail-safe).
          // - promoters: use the stored `rota` column; NULL (pre-migration) → true via COALESCE.
          // - collaborators: derived from `role_label` (English enum, verified column) + `is_active`.
          //   All four valid values (observer|supervisor|coordinator|brand_manager) → false.
          //   Unknown label → true (conservative: keep asking).
          // - users (staff): constant false (single-tenant by login).
          `SELECT c.id AS "clientId", c.nombre AS "clientName",
                  bool_or(x.rota) AS "rota"
             FROM clients c
             JOIN (
               SELECT client_id, COALESCE(rota, true) AS rota
                 FROM promoters
                WHERE status = 'active'
                  AND phone IS NOT NULL
                  AND regexp_replace(phone, '\\D', '', 'g') = $1
               UNION ALL
               SELECT client_id,
                 CASE WHEN role_label IN ('observer','supervisor','coordinator','brand_manager')
                      THEN false ELSE true END AS rota
                 FROM collaborators
                WHERE is_active = true
                  AND phone IS NOT NULL
                  AND regexp_replace(phone, '\\D', '', 'g') = $1
               UNION ALL
               SELECT client_id, false AS rota
                 FROM users
                WHERE is_active = true
                  AND role IN ($2, $3, $4)
                  AND phone IS NOT NULL
                  AND regexp_replace(phone, '\\D', '', 'g') = $1
             ) x ON x.client_id = c.id
            GROUP BY c.id, c.nombre
            ORDER BY c.nombre`,
          [digits, UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERVISOR],
        ),
      );

      return (rows as ClientCandidate[]).map((r) => ({
        clientId: r.clientId,
        clientName: r.clientName,
        rota: r.rota as boolean,
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

  /**
   * Client ids where the sender has an OPEN convocatoria (F4). A convocatoria is open
   * when its estado is 'enviada' or 'pendiente', it is NOT caducated (its event `dia`
   * is within a 1-day grace window of today — same bound as
   * `tieneConvocatoriaAbierta`), and it belongs to a promoter whose phone digits match
   * `from`. When exactly one candidate client appears here the
   * agency is unambiguous (the system itself sent that convocatoria), so the caller can
   * auto-resolve the tenant and route the reply straight to the F4 classifier instead
   * of asking "which agency?".
   *
   * Cross-tenant discovery BEFORE the tenant is known → runs under `runAsSystem`, same
   * as `candidatesFor`. A DB error is re-thrown (never swallowed to []): swallowing it
   * would silently skip the convocatoria path and wrongly ask the agency.
   */
  async clientsWithOpenConvocatoria(from: string): Promise<string[]> {
    const digits = normalizePhone(from);
    if (!digits) return [];

    try {
      const rows = await runAsSystem(() =>
        this.ds.query(
          `SELECT DISTINCT c.client_id AS "clientId"
             FROM convocatorias c
             JOIN promoters p ON p.id = c.persona_id AND p.client_id = c.client_id
            WHERE c.estado IN ('enviada','pendiente')
              AND c.dia >= CURRENT_DATE - INTERVAL '1 day'
              AND p.phone IS NOT NULL
              AND regexp_replace(p.phone, '\\D', '', 'g') = $1`,
          [digits],
        ),
      );

      return (rows as { clientId: string }[]).map((r) => r.clientId);
    } catch (err: any) {
      // A swallowed error would return [] and wrongly skip the convocatoria auto-resolve,
      // pre-empting the F4 reply with a "which agency?" prompt. Re-throw so the caller can
      // decide (the controller treats the optimization as best-effort and falls through).
      this.logger.error(
        `[WhatsApp] clientsWithOpenConvocatoria error from=${from}: ${err.message}`,
      );
      throw err;
    }
  }
}
