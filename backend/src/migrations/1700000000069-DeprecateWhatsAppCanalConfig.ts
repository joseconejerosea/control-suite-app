import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Single-global-number model (Tajada D) — strip the now-dead per-tenant WhatsApp
 * number config from canal_entrada.
 *
 * Under one global Meta number the code no longer reads or writes a per-channel
 * phone_number_id / WABA (Tajadas A/B/C removed every reader and writer). Existing
 * tipo='whatsapp' rows still carry those keys in their JSONB `config` as dead data,
 * which is misleading (it looks like live per-number routing state). Remove the keys
 * while KEEPING the row itself (it still marks "this tenant uses WhatsApp" and its
 * is_active flag is used by onboarding completion). Email / generic channels are not
 * touched — their config (webhook_secret, sheets_id, etc.) stays intact.
 */
const WA_CONFIG_KEYS = [
  'phone_number_id',
  'display_phone_number',
  'verified_name',
  'waba_id',
  'cc',
  'raw_phone_number',
];

export class DeprecateWhatsAppCanalConfig1700000000069 implements MigrationInterface {
  name = 'DeprecateWhatsAppCanalConfig1700000000069';

  public async up(q: QueryRunner): Promise<void> {
    // `config - 'k1' - 'k2' ...` removes each key from the JSONB object.
    const strip = WA_CONFIG_KEYS.map((k) => `- '${k}'`).join(' ');
    await q.query(`
      UPDATE canal_entrada
         SET config = config ${strip}
       WHERE tipo = 'whatsapp'
         AND config IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    // Forward-only: the stripped per-number config is dead data with no source of
    // truth to restore it from (the global number lives in env, not per channel).
  }
}
