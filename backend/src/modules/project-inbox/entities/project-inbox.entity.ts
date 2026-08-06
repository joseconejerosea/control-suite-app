import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Client } from '../../clients/client.entity';

export type InboxSource = 'EMAIL' | 'UPLOAD' | 'WHATSAPP';
export type InboxStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'APPROVED' | 'REJECTED';

@Entity('project_inbox')
@Index('idx_project_inbox_tenant', ['tenant_id'])
export class ProjectInbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Client;

  @Column({ type: 'varchar', length: 20 })
  source!: InboxSource;

  @Column({ type: 'jsonb' })
  raw_content!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  extracted_data!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  conflicts!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  missing_fields!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: InboxStatus;

  @Column({ type: 'uuid', nullable: true })
  project_id!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
