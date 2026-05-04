import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';
import { Rendicion } from './rendicion.entity';

@Entity({ name: 'rendicion_items' })
export class RendicionItem extends TenantBaseEntity {
  @Column({ type: 'uuid' })
  rendicion_id: string;

  @ManyToOne(() => Rendicion, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rendicion_id' })
  rendicion: Rendicion;

  @Column({ type: 'uuid', nullable: true })
  invoice_id: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  monto: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;
}
