import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController, AdminSupportController } from './support.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ResendEmailService } from '../../common/email/resend.service';

@Module({
  imports:     [WhatsAppModule],
  controllers: [SupportController, AdminSupportController],
  providers:   [SupportService, ResendEmailService],
  exports:     [SupportService],
})
export class SupportModule {}
