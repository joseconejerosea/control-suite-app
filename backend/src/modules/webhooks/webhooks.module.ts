import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { QueueModule } from '../queue/queue.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [QueueModule, InvoicesModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
