import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantBaseEntity } from '../../common/entities/tenant-base.entity';
import { Client } from '../clients/client.entity';
import { Project } from '../projects/project.entity';

export type InvoiceSource   = 'email' | 'whatsapp' | 'manual';
export type InvoiceCategory = 'sale' | 'cost' | 'expense';
export type InvoiceStatus   = 'pending' | 'confirmed' | 'rejected';

@Entity({ name: 'invoices' })
@Index('IDX_INVOICES_SOURCE',   ['source'])
@Index('IDX_INVOICES_CATEGORY', ['category'])
@Index('IDX_INVOICES_DATE',     ['invoice_date'])
export class Invoice extends TenantBaseEntity {

  @ManyToOne(() => Client, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ type: 'varchar', length: 20, default: 'manual' })
  source: InvoiceSource;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'vendor_name' })
  vendor_name: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  amount: string | null;

  @Column({ type: 'varchar', length: 10, default: 'CLP' })
  currency: string;

  @Column({ type: 'date', nullable: true, name: 'invoice_date' })
  invoice_date: string | null;

  @Column({ type: 'varchar', length: 20, default: 'cost' })
  category: InvoiceCategory;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: InvoiceStatus;

  @Column({ type: 'jsonb', nullable: true, name: 'raw_payload' })
  raw_payload: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true, name: 'ai_extracted' })
  ai_extracted: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true, name: 'project_id' })
  project_id: string | null;

  @ManyToOne(() => Project, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;
}
