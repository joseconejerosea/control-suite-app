import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { TenantBaseEntity } from '../../common/entities/tenant-base.entity';
import { Client } from '../clients/client.entity';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';

export type DocumentUploadStatus =
  | 'uploaded'
  | 'processing'
  | 'parsed'
  | 'populated'
  | 'error';

export type TargetTable =
  | 'promoters'
  | 'locations'
  | 'campaigns'
  | 'activations'
  | 'collaborators';

export interface ParseResultRow {
  [key: string]: string | number | boolean | null;
}

export interface ParseResult {
  rows: ParseResultRow[];
  columns: string[];
  mapping: Record<string, string>;
  confidence: number;
  warnings: string[];
  tokens_used?: { prompt: number; completion: number };
  errors?: Array<{ row_index: number; reason: string }>;
}

@Entity({ name: 'document_uploads' })
@Index('IDX_DOCUPLOADS_STATUS', ['status'])
@Index('IDX_DOCUPLOADS_PROJECT', ['project_id'])
export class DocumentUpload extends TenantBaseEntity {

  @ManyToOne(() => Client, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ type: 'uuid', name: 'uploaded_by' })
  uploaded_by: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'uploaded_by' })
  uploader: User;

  @Column({ type: 'uuid', name: 'project_id', nullable: true })
  project_id: string | null;

  @ManyToOne(() => Project, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @Column({ type: 'varchar', length: 500, name: 'original_name' })
  original_name: string;

  @Column({ type: 'varchar', length: 100, name: 'mime_type' })
  mime_type: string;

  @Column({ type: 'integer', name: 'file_size' })
  file_size: number;

  @Column({ type: 'varchar', length: 1000, name: 'storage_path' })
  storage_path: string;

  @Column({ type: 'varchar', length: 30, default: 'uploaded' })
  status: DocumentUploadStatus;

  @Column({ type: 'jsonb', nullable: true, name: 'parse_result' })
  parse_result: ParseResult | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'target_table' })
  target_table: TargetTable | null;

  @Column({ type: 'integer', nullable: true, default: 0, name: 'rows_inserted' })
  rows_inserted: number;

  @Column({ type: 'integer', nullable: true, default: 0, name: 'rows_failed' })
  rows_failed: number;

  @Column({ type: 'text', nullable: true, name: 'error_detail' })
  error_detail: string | null;
}