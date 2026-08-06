import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { Project } from '../../projects/project.entity';

@Entity('activations')
export class Activation extends TenantBaseEntity {
  @Column({ type: 'uuid' })
  campaign_id!: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  @Column({ type: 'uuid', nullable: true })
  location_id!: string | null;

  @Column({ type: 'uuid', nullable: true })
  promoter_id!: string | null;

  @Column({ type: 'uuid', nullable: true })
  project_id!: string | null;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project!: Project | null;

  @Column({ type: 'varchar', default: 'pending' })
  status!: string;

  @Column({ type: 'timestamp', nullable: true })
  scheduled_at!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  executed_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'date', nullable: true })
  activation_date!: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'pendiente' })
  estado_f5!: string;

  @Column({ type: 'timestamptz', nullable: true })
  cerrada_at!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  cierre_jsonb!: unknown;

  @Column({ type: 'boolean', default: false })
  cierre_incompleto!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  location!: { address: string; lat: number; lng: number; radiusMeters: number } | null;
}