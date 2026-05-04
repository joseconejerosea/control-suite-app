import { Column, Entity, Index } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';

export type PropuestaTipo     = 'proactivo' | 'ejecutor' | 'analista';
export type PropuestaSeveridad = 'critica' | 'alta' | 'media' | 'baja';
export type PropuestaEstado   = 'abierta' | 'aprobada' | 'rechazada' | 'expirada';

@Entity({ name: 'mind_propuestas' })
@Index('idx_mind_propuestas_client', ['client_id', 'estado'])
export class MindPropuesta extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 20, default: 'proactivo' }) tipo: PropuestaTipo;
  @Column({ type: 'varchar', length: 30, nullable: true }) perfil_origen: string | null;
  @Column({ type: 'varchar', length: 512 }) titulo: string;
  @Column({ type: 'text', nullable: true }) descripcion: string | null;
  @Column({ type: 'varchar', length: 20, default: 'media' }) severidad: PropuestaSeveridad;
  @Column({ type: 'jsonb', nullable: true }) accion_propuesta: Record<string, unknown> | null;
  @Column({ type: 'varchar', length: 20, default: 'abierta' }) estado: PropuestaEstado;
  @Column({ type: 'timestamptz', nullable: true }) expira_at: Date | null;
  @Column({ type: 'uuid', nullable: true }) aprobada_por_user_id: string | null;
  @Column({ type: 'timestamptz', nullable: true }) aprobada_at: Date | null;
  @Column({ type: 'text', nullable: true }) rechazada_motivo: string | null;
}
