import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';
import { Location } from '../../locations/entities/location.entity';
import { Project } from '../../projects/project.entity';

@Entity('campaigns')
export class Campaign extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'date' })
  start_date!: Date;

  @Column({ type: 'date' })
  end_date!: Date;

  @Index('IDX_CAMPAIGN_STATUS')
  @Column({
    type: 'enum',
    enum: ['draft', 'active', 'paused', 'completed', 'cancelled'],
    default: 'draft',
  })
  status!: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  budget!: number | null;

  @Index('IDX_CAMPAIGN_LOCATION')
  @Column({ type: 'uuid', nullable: true })
  location_id!: string | null;

  @ManyToOne(() => Location, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'location_id' })
  location!: Location;

  // ── H5: Project FK ───────────────────────────────────────────────────────
  @Index('IDX_CAMPAIGNS_PROJECT')
  @Column({ type: 'uuid', nullable: true })
  project_id!: string | null;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project!: Project | null;
}