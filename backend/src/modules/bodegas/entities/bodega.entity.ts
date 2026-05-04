import { Column, Entity, Index } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';

export type BodegaTipo = 'principal' | 'sub_bodega' | 'aeropuerto' | 'regional';

@Entity({ name: 'bodegas' })
@Index('idx_bodegas_client_id', ['client_id', 'active'])
export class Bodega extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 255 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  @Column({ type: 'uuid', nullable: true })
  encargado_persona_id: string | null;

  @Column({ type: 'varchar', length: 30, default: 'principal' })
  tipo: BodegaTipo;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}
