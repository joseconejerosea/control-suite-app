import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('users') //  user → users
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  username!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  //  ADD THIS (CRITICAL)
  @Column()
  client_id!: number;

  //  OPTIONAL (strong impression)
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;
}