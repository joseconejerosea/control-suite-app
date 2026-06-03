import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Activation } from './activation.entity';

export type EventType = 'LOCATION_CHECK' | 'REPORT' | 'PHOTO' | 'INCIDENT';
export type LocationStatus = 'VERIFIED' | 'MISMATCH' | 'PENDING';

@Entity('activation_events')
@Index('idx_activation_events_activation', ['activation_id'])
@Index('idx_activation_events_client', ['client_id', 'event_type'])
export class ActivationEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  client_id!: string;

  @Column({ type: 'uuid' })
  activation_id!: string;

  @ManyToOne(() => Activation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'activation_id' })
  activation!: Activation;

  @Column({ type: 'varchar', length: 20 })
  event_type!: EventType;

  @Column({ type: 'varchar', length: 20, nullable: true })
  location_status!: LocationStatus | null;

  @Column({ type: 'double precision', nullable: true })
  lat!: number | null;

  @Column({ type: 'double precision', nullable: true })
  lng!: number | null;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  media_url!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
