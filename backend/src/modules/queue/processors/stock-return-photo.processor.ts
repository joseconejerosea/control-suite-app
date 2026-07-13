import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { StockReturnsService } from '../../movimientos-pop/stock-returns.service';
import { runWithTenant } from '../../../common/tenant/tenant-context';

export const QUEUE_STOCK_RETURN_PHOTO = 'stock-return-photo';

interface StockReturnPhotoJob {
  client_id:         string;
  return_request_id: string;
  storage_path:      string;
}

/**
 * F3 devoluciones — procesa la foto que un promotor manda por WhatsApp en
 * respuesta a un pedido de devolución. El webhook detecta que el emisor tiene una
 * devolución pendiente, descarga la media y encola acá; este processor llama a
 * receivePhoto (clasifica la foto con Claude + setea photo_key), como QUEUE
 * PROCESSOR (mismo patrón que OCR/convocatoria, NO inline en el webhook para no
 * bloquear la respuesta a Meta con la llamada a la IA).
 */
@Processor(QUEUE_STOCK_RETURN_PHOTO)
export class StockReturnPhotoProcessor extends WorkerHost {
  private readonly logger = new Logger(StockReturnPhotoProcessor.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly stockReturns: StockReturnsService,
  ) {
    super();
  }

  async process(job: Job<StockReturnPhotoJob>): Promise<void> {
    const { client_id, return_request_id, storage_path } = job.data;
    // Tx con app.current_tenant = client_id para respetar RLS (igual que F1/F4).
    await runWithTenant(this.ds, client_id, () =>
      this.stockReturns.receivePhoto(client_id, return_request_id, storage_path),
    );
    this.logger.log(`[F3Returns] Foto de devolución procesada return=${return_request_id}`);
  }
}
