import { Column, Entity, Index, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';
import { RendicionItem } from './rendicion-item.entity';

export type RendicionEstado = 'borrador' | 'enviada' | 'aprobada' | 'pagada' | 'rechazada';

@Entity({ name: 'rendiciones' })
@Index('idx_rendiciones_client_estado', ['client_id', 'estado'])
export class Rendicion extends TenantBaseEntity {
  @Column({ type: 'uuid' })
  persona_id: string;

  @Column({ type: 'uuid', nullable: true })
  project_id: string | null;

  @Column({ type: 'varchar', length: 10 })
  periodo: string; // '2026-W43'

  @Column({ type: 'varchar', length: 20, default: 'borrador' })
  estado: RendicionEstado;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  monto_total: string;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  porcentaje_presupuesto: string | null;

  @Column({ type: 'boolean', default: false })
  aprobada_auto: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  aprobada_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  aprobada_por_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rechazada_at: Date | null;

  @Column({ type: 'text', nullable: true })
  rechazada_motivo: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pagada_at: Date | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  comprobante_pago_key: string | null;

  @Column({ type: 'boolean', default: false })
  requiere_admin: boolean;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  excede_por_clp: string | null;

  @OneToMany(() => RendicionItem, (item) => item.rendicion, { cascade: true })
  items: RendicionItem[];
}
