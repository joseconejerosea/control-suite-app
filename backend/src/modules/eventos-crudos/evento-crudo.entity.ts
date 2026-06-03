import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CanalEntrada } from '../canal-entrada/canal-entrada.entity';

@Entity('eventos_crudos')
export class EventoCrudo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true }) // nullable for sin_contexto events
  client_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  canal_entrada_id: string | null;

  @ManyToOne(() => CanalEntrada, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'canal_entrada_id' })
  canal_entrada: CanalEntrada;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  source: string; // 'whatsapp' | 'email' | 'generic'

  @Column({ type: 'boolean', default: false })
  processed: boolean; // legacy — keep for backward compatibility

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'received' })
  status: string; // received|queued|processing|processed|error|sin_contexto

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  queued_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date | null;

  @Column({ type: 'varchar', nullable: true })
  job_id: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'varchar', nullable: true, unique: false })
  idempotency_key: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  flow: string | null;

  @Column({ type: 'jsonb', nullable: true })
  parsed_data: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
