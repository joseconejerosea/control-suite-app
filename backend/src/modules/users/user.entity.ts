import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Client } from '../clients/client.entity';
import { UserRole } from '../../common/enums/user-role.enum';

@Entity('users')
@Index('IDX_USERS_CLIENT_EMAIL', ['client_id', 'email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  client_id!: string | null;

  @Column()
  email!: string;

  @Exclude()
  @Column()
  password!: string;

  @Column({ default: UserRole.OPERATOR })
  role!: UserRole;

  @Column({ type: 'varchar', length: 100, nullable: true })
  full_name!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 5, default: 'es' })
  language!: string;

  @Column({ default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @ManyToOne(() => Client, (client) => client.users, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'client_id' })
  client!: Client | null;
}