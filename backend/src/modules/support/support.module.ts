import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController, AdminSupportController } from './support.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports:     [WhatsAppModule],
  controllers: [SupportController, AdminSupportController],
  providers:   [SupportService],
  exports:     [SupportService],
})
export class SupportModule {}
