import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Single-global-number model (Tajada C) removed the WhatsApp provisioning steps
 * 'wa_number_requested' and 'wa_number_verified' from the onboarding state machine.
 * Any client still parked at one of those steps would map to stepIndex -1 and be
 * unable to create an admin or complete onboarding until re-configured. Normalize
 * them to 'channel_verified' (the equivalent "channel is active" milestone) so any
 * in-flight onboarding continues seamlessly after the deploy.
 */
export class NormalizeLegacyOnboardingSteps1700000000068 implements MigrationInterface {
  name = 'NormalizeLegacyOnboardingSteps1700000000068';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE clients
         SET onboarding_step = 'channel_verified'
       WHERE onboarding_step IN ('wa_number_requested', 'wa_number_verified')
    `);
  }

  public async down(): Promise<void> {
    // Forward-only normalization: the legacy step values map to no state in the new
    // machine, so there is nothing meaningful to restore.
  }
}
