import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppMediaService } from './whatsapp-media.service';
import { WhatsappOutputService } from './whatsapp-output.service';
import { OperatorNotifierService } from './operator-notifier.service';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller';
import { PromptShieldService } from '../../common/ai/prompt-shield.service';

const QUEUE_OCR = 'ocr';
const QUEUE_CONVOCATORIA_CLASSIFY = 'convocatoria-classify';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_OCR },
      { name: QUEUE_CONVOCATORIA_CLASSIFY },
    ),
  ],
  controllers: [WhatsAppWebhookController],
  providers:   [WhatsAppService, WhatsAppSessionService, WhatsAppMediaService, WhatsappOutputService, OperatorNotifierService, PromptShieldService],
  exports:     [WhatsAppService, WhatsAppSessionService, WhatsappOutputService, OperatorNotifierService],
})
export class WhatsAppModule {}
