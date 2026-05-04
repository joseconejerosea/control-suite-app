import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';

@Entity('promoters')
export class Promoter extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 150 })
  first_name!: string;

  @Column({ type: 'varchar', length: 150 })
  last_name!: string;

  @Index('IDX_PROMOTER_EMAIL')
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rut!: string | null;

  @Index('IDX_PROMOTER_STATUS')
  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'suspended'],
    default: 'active',
  })
  status!: 'active' | 'inactive' | 'suspended';
}