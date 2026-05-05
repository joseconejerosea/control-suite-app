import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  client_id: string;

  @Column({ nullable: true })
  user_id: string;

  @Column()
  tipo: string;

  @Column('text')
  descripcion: string;

  @Column({ default: 'media' })
  prioridad: string;

  @Column({ default: 'abierto' })
  estado: string;

  @Column({ nullable: true, type: 'text' })
  respuesta: string;

  @Column({ nullable: true })
  respondido_por: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
