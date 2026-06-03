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

@Entity('users')
@Index('IDX_USERS_CLIENT_EMAIL', ['client_id', 'email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  client_id!: string;

  @Column()
  email!: string;

  @Exclude()
  @Column()
  password!: string;

  @Column({ default: 'user' })
  role!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  full_name!: string | null;

  @Column({ type: 'varchar', length: 5, default: 'es' })
  language!: string;

  @Column({ default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @ManyToOne(() => Client, (client) => client.users, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client!: Client;
}