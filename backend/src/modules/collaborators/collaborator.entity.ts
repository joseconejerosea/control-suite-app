import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { TenantBaseEntity } from '../../common/entities/tenant-base.entity';
import { Client } from '../clients/client.entity';
import { Project } from '../projects/project.entity';

export type CollaboratorRole = 'observer' | 'supervisor' | 'coordinator' | 'brand_manager';

@Entity({ name: 'collaborators' })
@Index('IDX_COLLABORATORS_PROJECT', ['project_id'])
export class Collaborator extends TenantBaseEntity {
  // id, client_id, created_at, updated_at are inherited from TenantBaseEntity

  @ManyToOne(() => Client, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ type: 'uuid', name: 'project_id', nullable: true })
  project_id: string | null;

  @ManyToOne(() => Project, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @Column({ type: 'varchar', length: 255, name: 'full_name' })
  full_name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 100, default: 'observer', name: 'role_label' })
  role_label: CollaboratorRole;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  is_active: boolean;

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, unknown> | null;
}