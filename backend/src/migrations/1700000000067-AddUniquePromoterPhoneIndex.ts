import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Single-global-number model — race-safe affiliation idempotency.
 *
 * AffiliationService.affiliate() must never create two active promoters for the same
 * phone in the same client (two concurrent affiliations would otherwise both pass the
 * check-then-act SELECT and both INSERT). This UNIQUE PARTIAL EXPRESSION index enforces
 * uniqueness on (client_id, normalized phone) among ACTIVE promoters and is the exact
 * conflict target of the `ON CONFLICT (client_id, regexp_replace(phone,'\D','','g'))
 * WHERE status='active' DO NOTHING` in affiliate().
 *
 * The `regexp_replace(phone,'\D','','g')` expression is IMMUTABLE, so it is valid in an
 * index. The partial predicate (status='active') matches the affiliate() conflict target
 * so Postgres can infer this index. Only 'active' rows are constrained, so historical
 * inactive/duplicate rows do not block the index creation.
 *
 * Deploy order: this index must exist before the ON CONFLICT code path runs. It ships in
 * the same change as the affiliate() rewrite; run migrations before deploying the app.
 */
export class AddUniquePromoterPhoneIndex1700000000067 implements MigrationInterface {
  name = 'AddUniquePromoterPhoneIndex1700000000067';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_PROMOTERS_ACTIVE_PHONE_PER_CLIENT"
        ON promoters (client_id, (regexp_replace(phone, '\\D', '', 'g')))
        WHERE status = 'active'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_PROMOTERS_ACTIVE_PHONE_PER_CLIENT"`);
  }
}
