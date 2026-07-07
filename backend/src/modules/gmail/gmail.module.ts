import { Module } from '@nestjs/common';
import { GmailService } from './gmail.service';
import { GmailController } from './gmail.controller';
import { InvoicesModule } from '../invoices/invoices.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [InvoicesModule, WhatsAppModule],
  controllers: [GmailController],
  providers: [GmailService],
  exports: [GmailService],
})
export class GmailModule {}
