import { Column, Entity, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '../../common/entities/tenant-base.entity';
import { Client } from '../clients/client.entity';

@Entity('canal_entrada')
export class CanalEntrada extends TenantBaseEntity {
  @Column({ type: 'varchar' })
  nombre: string;

  @Column({ type: 'varchar' })
  tipo: string; // 'whatsapp' | 'email' | 'generic'

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  
  @ManyToOne(() => Client, (client) => client.canales, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client: Client;
}