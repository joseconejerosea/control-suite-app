import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Single global WhatsApp number model — onboarding no longer configures channels.
 * The step machine is now: client_created -> admin_created -> completed. The
 * intermediate 'channel_configured' / 'channel_verified' steps are gone, so any
 * in-flight client parked at one of them is moved back to 'client_created' (they
 * still need to create an admin, which is the next step). No admin exists yet at
 * those steps — admin_created came after them — so no progress is lost.
 */
export class SimplifyOnboardingSteps1700000000071 implements MigrationInterface {
  name = 'SimplifyOnboardingSteps1700000000071';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE clients
         SET onboarding_step = 'client_created'
       WHERE onboarding_step IN ('channel_configured', 'channel_verified')
    `);
  }

  public async down(): Promise<void> {
    // Forward-only: the removed steps have no place in the new machine.
  }
}
