import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * No DDL change required — role is already VARCHAR(50).
 * This migration documents the updated set of valid role values:
 *   'user'          — standard end user
 *   'admin'         — legacy admin (kept for backwards compat)
 *   'admin_cliente' — tenant admin, created during onboarding
 *   'super_admin'   — platform-level admin, can manage all clients
 *
 * Role enforcement is handled by RolesGuard + @Roles() decorator in the application layer.
 */
export class UpdateUserRoles1700000000012 implements MigrationInterface {
  name = 'UpdateUserRoles1700000000012';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // No structural change — role validation is enforced at the application layer.
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to revert.
  }
}
