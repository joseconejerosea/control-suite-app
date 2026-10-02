import { Module } from '@nestjs/common';
import { MailIngestionService } from './mail-ingestion.service';
import { MailController } from './mail.controller';
import { GmailProvider } from './providers/gmail.provider';
import { OutlookProvider } from './providers/outlook.provider';
import { MAILBOX_PROVIDERS } from './mail-provider.interface';
import { InvoicesModule } from '../invoices/invoices.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [InvoicesModule, WhatsAppModule],
  controllers: [MailController],
  providers: [
    GmailProvider,
    OutlookProvider,
    {
      // Registry of mailbox providers.
      provide: MAILBOX_PROVIDERS,
      useFactory: (gmail: GmailProvider, outlook: OutlookProvider) => [gmail, outlook],
      inject: [GmailProvider, OutlookProvider],
    },
    MailIngestionService,
  ],
  exports: [MailIngestionService],
})
export class MailModule {}
