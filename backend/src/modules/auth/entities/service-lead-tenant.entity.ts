import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';
import { Client } from '../../clients/client.entity';

/**
 * ServiceLeadTenant — asignación de un SERVICE_LEAD a una agencia (tenant).
 *
 * Tabla PLATFORM-LEVEL / CROSS-TENANT: a diferencia del resto del modelo, NO
 * extiende TenantBaseEntity y NO lleva RLS por tenant. El SERVICE_LEAD no tiene
 * un tenant fijo; puede estar asignado a varias agencias y elige la activa al
 * loguear (ver AuthService.selectTenant). Aislar esta tabla por tenant rompería
 * su propósito (nunca podría verse a sí misma bajo el filtro app.current_tenant).
 *
 * El aislamiento efectivo lo garantiza ServiceLeadGuard, que valida en cada
 * request que exista la fila (user_id, tenant_id) para el tenant activo del JWT.
 */
@Entity({ name: 'service_lead_tenants' })
@Index('UQ_SERVICE_LEAD_TENANTS_USER_TENANT', ['user_id', 'tenant_id'], {
  unique: true,
})
export class ServiceLeadTenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenant_id: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Client;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}
