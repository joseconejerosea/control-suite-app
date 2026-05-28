import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller';

// Brief §F1: WA images must enter the OCR pipeline
const QUEUE_OCR = 'ocr';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_OCR }),
  ],
  controllers: [WhatsAppWebhookController],
  providers:   [WhatsAppService],
  exports:     [WhatsAppService],
})
export class WhatsAppModule {}
