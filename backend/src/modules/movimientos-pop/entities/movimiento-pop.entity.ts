import { Column, Entity, Index } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';

export type MovimientoTipo   = 'salida' | 'entrada' | 'devolucion' | 'consumo' | 'merma' | 'transfer' | 'adjustment';
export type MovimientoEstado = 'en_terreno' | 'devuelto_completo' | 'devuelto_parcial' | 'consumido' | 'merma' | 'transfer_out' | 'transfer_in' | 'adjustment';

@Entity({ name: 'movimientos_pop' })
@Index('idx_movimientos_client_tipo', ['client_id', 'tipo', 'estado'])
export class MovimientoPop extends TenantBaseEntity {
  @Column({ type: 'uuid' }) sku_id: string;
  @Column({ type: 'uuid', nullable: true }) persona_id: string | null;
  @Column({ type: 'uuid', nullable: true }) bodega_origen_id: string | null;
  @Column({ type: 'uuid', nullable: true }) proyecto_destino_id: string | null;
  @Column({ type: 'varchar', length: 20 }) tipo: MovimientoTipo;
  @Column({ type: 'integer', default: 0 }) cantidad: number;
  @Column({ type: 'varchar', length: 512, nullable: true }) foto_key: string | null;
  @Column({ type: 'integer', nullable: true }) tiempo_uso_dias: number | null;
  @Column({ type: 'date', nullable: true }) fecha_retorno_esperada: string | null;
  @Column({ type: 'date', nullable: true }) fecha_retorno_real: string | null;
  @Column({ type: 'varchar', length: 30, default: 'en_terreno' }) estado: MovimientoEstado;
  @Column({ type: 'integer', nullable: true }) correlativo: number | null;
  @Column({ type: 'text', nullable: true }) observacion: string | null;
  @Column({ type: 'uuid', nullable: true }) raw_event_id: string | null;
  @Column({ type: 'uuid', nullable: true }) activacion_id: string | null;
}
