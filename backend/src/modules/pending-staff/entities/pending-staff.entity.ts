import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Roster-gap queue entry. One row per (client_id, phone) — the UNIQUE
 * constraint means the same unknown phone generates exactly one pending_staff
 * record per tenant, regardless of how many evidence submissions arrive.
 *
 * estado lifecycle: pendiente → agregado | descartado (never deleted).
 * No FK on phone: the promoter does not exist yet.
 */
@Entity('pending_staff')
@Index('idx_pending_staff_estado', ['client_id', 'estado'])
export class PendingStaff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  client_id!: string;

  @Column({ type: 'varchar', length: 30 })
  phone!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  motivo!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  contexto!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: 'pendiente' })
  estado!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
