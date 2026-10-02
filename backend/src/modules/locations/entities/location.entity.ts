import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';
import { Project } from '../../projects/project.entity';

@Entity('locations')
export class Location extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  postal_code!: string | null;

  @Index('IDX_LOCATION_STATUS')
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  /**
   * B5 — Optional FK to the owning project.
   * NULL for tenant-level (legacy) locations; set for project-scoped PDVs.
   */
  @Column({ type: 'uuid', nullable: true, name: 'project_id' })
  project_id!: string | null;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project | null;
}