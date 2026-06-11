// ─── Entity ───────────────────────────────────────────────────────────────────
import { Column, Entity, Index } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';

export type SkuTipo = 'reusable' | 'consumible';

@Entity({ name: 'skus' })
@Index('idx_skus_client_id', ['client_id', 'active'])
export class Sku extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 100 }) codigo: string;
  @Column({ type: 'varchar', length: 255 }) nombre: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) cliente_final: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) dimensiones: string | null;
  @Column({ type: 'decimal', precision: 8, scale: 3, nullable: true }) peso_kg: string | null;
  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true }) valor_unitario: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) proveedor_fabricacion: string | null;
  @Column({ type: 'date', nullable: true }) fabricado_at: string | null;
  @Column({ type: 'varchar', length: 512, nullable: true }) foto_key: string | null;
  @Column({ type: 'varchar', length: 512, nullable: true }) ficha_tecnica_key: string | null;
  @Column({ type: 'varchar', length: 20, default: 'reusable' }) tipo: SkuTipo;
  @Column({ type: 'int', default: 0 }) min_stock: number;
  @Column({ type: 'boolean', default: true }) active: boolean;
}
