import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
@Index('idx_audit_logs_tenant', ['tenant_id'])
@Index('idx_audit_logs_user', ['user_id'])
@Index('idx_audit_logs_entity', ['entity', 'entity_id'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  tenant_id!: string | null;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @Column({ type: 'varchar', length: 100 })
  entity!: string;

  @Column({ type: 'varchar', length: 255 })
  entity_id!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
