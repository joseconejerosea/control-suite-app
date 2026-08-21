import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '../../../common/entities/tenant-base.entity';
import { PROMOTOR_ROL_TIPO_MEMBERS } from '../../../common/promoter-role/role-rota.util';

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

  // Rol/perfil legacy (texto libre). Se conserva para compatibilidad durante la transición.
  // El valor estructurado vive en rol_tipo.
  @Column({ type: 'varchar', length: 100, nullable: true })
  rol!: string | null;

  // Rol estructurado DB-enforced (enum promotor_rol_tipo_enum). Nullable para filas
  // pre-migración con rol no mapeable.
  @Column({
    type: 'enum',
    enum: PROMOTOR_ROL_TIPO_MEMBERS,
    nullable: true,
    name: 'rol_tipo',
  })
  rol_tipo!: string | null;

  // Flag de rotación: true = el promotor trabaja en múltiples clientes/proyectos.
  // Derivado en el servicio desde rol_tipo (no editable por el cliente — spec I-6).
  @Column({ type: 'boolean', default: true })
  rota!: boolean;
}