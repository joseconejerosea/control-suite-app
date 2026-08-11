import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { CanalEntrada } from '../canal-entrada/canal-entrada.entity';

/**
 * Client represents a tenant organisation.
 * It intentionally does NOT extend TenantBaseEntity — this IS the tenant root.
 * Its `id` becomes the `client_id` referenced by all other tenant-scoped tables.
 *
 * Valid status values:   'onboarding' | 'active' | 'suspended' | 'cancelled'
 * Valid onboarding_step: 'client_created' | 'channel_configured' |
 *                        'channel_verified' | 'admin_created' | 'completed'
 */
@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  nombre: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rut: string | null;

  @Column({ type: 'varchar', length: 50, default: 'basic' })
  plan: string;

  @Column({ type: 'varchar', length: 30, default: 'onboarding' })
  status: string;

  @Column({ type: 'varchar', length: 30, default: 'client_created' })
  onboarding_step: string;

  // Single-global-number model: the credential a promoter/host types over WhatsApp
  // to affiliate to this agency. Unique across all tenants; rotatable.
  @Column({ type: 'varchar', length: 16, unique: true })
  affiliation_code: string;

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  onboarding_completed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToMany(() => User, (user) => user.client)
  users: User[];

  @OneToMany(() => CanalEntrada, (canal) => canal.client)
  canales: CanalEntrada[];
}
