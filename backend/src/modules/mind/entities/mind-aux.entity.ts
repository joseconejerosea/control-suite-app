import { Column, Entity, Index } from 'typeorm';

// ─── MindChatHistory ──────────────────────────────────────────────────────────
@Entity({ name: 'mind_chat_history' })
@Index('idx_mind_chat_client_user', ['client_id', 'user_id'])
export class MindChatHistory {
  @Column({ primary: true, generated: 'uuid' }) id: string;
  @Column({ type: 'uuid' }) client_id: string;
  @Column({ type: 'uuid' }) user_id: string;
  @Column({ type: 'varchar', length: 20, default: 'user' }) role: 'user' | 'assistant';
  @Column({ type: 'text' }) mensaje: string;
  @Column({ type: 'jsonb', nullable: true }) tools_used: unknown[] | null;
  @Column({ type: 'timestamptz', default: () => 'NOW()' }) ts: Date;
}

// ─── MindAccionLog ────────────────────────────────────────────────────────────
@Entity({ name: 'mind_acciones_log' })
export class MindAccionLog {
  @Column({ primary: true, generated: 'uuid' }) id: string;
  @Column({ type: 'uuid' }) client_id: string;
  @Column({ type: 'uuid', nullable: true }) propuesta_id: string | null;
  @Column({ type: 'jsonb', nullable: true }) accion_ejecutada: unknown;
  @Column({ type: 'jsonb', nullable: true }) resultado: unknown;
  @Column({ type: 'uuid', nullable: true }) aprobada_por_user_id: string | null;
  @Column({ type: 'timestamptz', default: () => 'NOW()' }) ts: Date;
}

// ─── AICostLog ────────────────────────────────────────────────────────────────
@Entity({ name: 'ai_costs_log' })
export class AiCostLog {
  @Column({ primary: true, generated: 'uuid' }) id: string;
  @Column({ type: 'uuid' }) client_id: string;
  @Column({ type: 'uuid', nullable: true }) user_id: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) model: string | null;
  @Column({ type: 'integer', nullable: true }) input_tokens: number | null;
  @Column({ type: 'integer', nullable: true }) output_tokens: number | null;
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true }) cost_usd: string | null;
  @Column({ type: 'integer', nullable: true }) duration_ms: number | null;
  @Column({ type: 'varchar', length: 50, nullable: true }) perfil_origen: string | null;
  @Column({ type: 'jsonb', nullable: true }) contexto: unknown;
  @Column({ type: 'timestamptz', default: () => 'NOW()' }) ts: Date;
}
