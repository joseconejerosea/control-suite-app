import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppMediaService } from './whatsapp-media.service';
import { WhatsappOutputService } from './whatsapp-output.service';
import { OperatorNotifierService } from './operator-notifier.service';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller';
import { SenderTenantResolverService } from './sender-tenant-resolver.service';
import { WhatsAppTenantSelectionService } from './tenant-selection.service';
import { WhatsAppActionMenuService } from './action-menu.service';
import { PromptShieldService } from '../../common/ai/prompt-shield.service';
import { ClientsModule } from '../clients/clients.module';

const QUEUE_OCR = 'ocr';
const QUEUE_CONVOCATORIA_CLASSIFY = 'convocatoria-classify';
const QUEUE_STOCK_RETURN_PHOTO = 'stock-return-photo';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_OCR },
      { name: QUEUE_CONVOCATORIA_CLASSIFY },
      { name: QUEUE_STOCK_RETURN_PHOTO },
    ),
    // Provides AffiliationCodeService + AffiliationService for single-number routing.
    ClientsModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers:   [WhatsAppService, WhatsAppSessionService, WhatsAppMediaService, WhatsappOutputService, OperatorNotifierService, PromptShieldService, SenderTenantResolverService, WhatsAppTenantSelectionService, WhatsAppActionMenuService],
  exports:     [WhatsAppService, WhatsAppSessionService, WhatsappOutputService, OperatorNotifierService],
})
export class WhatsAppModule {}
