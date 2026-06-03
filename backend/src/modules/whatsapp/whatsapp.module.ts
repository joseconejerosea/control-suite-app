import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppMediaService } from './whatsapp-media.service';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller';

const QUEUE_OCR = 'ocr';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_OCR }),
  ],
  controllers: [WhatsAppWebhookController],
  providers:   [WhatsAppService, WhatsAppSessionService, WhatsAppMediaService],
  exports:     [WhatsAppService, WhatsAppSessionService],
})
export class WhatsAppModule {}
