import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomInt } from 'crypto';

/**
 * Single-global-number model — per-client affiliation code.
 *
 * Each agency gets a unique credential that promoters/hosts type over WhatsApp to
 * affiliate. Added nullable first, backfilled with unique codes for existing rows,
 * then locked to NOT NULL + UNIQUE. The generator mirrors AffiliationCodeService
 * (unambiguous alphabet, no O/0/I/1/L) so backfilled codes are hand-typeable too.
 *
 * Transaction / deploy-order guarantees:
 * - TypeORM runs ALL pending migrations in a SINGLE transaction by default
 *   (`migrationsTransactionMode: 'all'`; this project does not override it — see
 *   src/data-source.ts. Verified empirically: a later failing migration rolls back the
 *   whole batch). So this migration's ADD COLUMN → backfill → SET NOT NULL → CREATE
 *   UNIQUE INDEX all commit or all roll back together; there is no window where the
 *   column exists NOT NULL without codes.
 * - The new column MUST be populated (this migration) BEFORE the Client entity that maps
 *   `affiliation_code` as NOT NULL is deployed. Run migrations before rolling out the app
 *   so a deploy never inserts a client without a code. The NOT NULL + UNIQUE intent below
 *   is load-bearing (the affiliation code is a credential) and must not be weakened.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

export class AddAffiliationCodeToClients1700000000066 implements MigrationInterface {
  name = 'AddAffiliationCodeToClients1700000000066';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS affiliation_code VARCHAR(16)`);

    // Backfill existing rows with codes unique within the whole table.
    const existing: { affiliation_code: string }[] = await q.query(
      `SELECT affiliation_code FROM clients WHERE affiliation_code IS NOT NULL`,
    );
    const used = new Set(existing.map((r) => r.affiliation_code));

    const pending: { id: string }[] = await q.query(
      `SELECT id FROM clients WHERE affiliation_code IS NULL`,
    );
    for (const row of pending) {
      let code = generateCode();
      while (used.has(code)) code = generateCode();
      used.add(code);
      await q.query(`UPDATE clients SET affiliation_code = $1 WHERE id = $2`, [code, row.id]);
    }

    await q.query(`ALTER TABLE clients ALTER COLUMN affiliation_code SET NOT NULL`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_CLIENTS_AFFILIATION_CODE" ON clients(affiliation_code)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_CLIENTS_AFFILIATION_CODE"`);
    await q.query(`ALTER TABLE clients DROP COLUMN IF EXISTS affiliation_code`);
  }
}
