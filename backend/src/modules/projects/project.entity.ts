import {
  Column,
  Entity,
  Index,
} from 'typeorm';
import { TenantBaseEntity } from '../../common/entities/tenant-base.entity';

export type ProjectStatus = 'active' | 'paused' | 'archived';

@Entity({ name: 'projects' })
@Index('IDX_PROJECTS_STATUS', ['status'])
export class Project extends TenantBaseEntity {

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status: ProjectStatus;

  @Column({ type: 'date', nullable: true, name: 'start_date' })
  start_date: string | null;

  @Column({ type: 'date', nullable: true, name: 'end_date' })
  end_date: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  budget: string | null;

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, unknown> | null;
}