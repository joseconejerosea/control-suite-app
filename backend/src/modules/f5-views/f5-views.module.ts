import { Module } from '@nestjs/common';
import { F5ViewController } from './f5-views.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsAppModule],
  controllers: [F5ViewController],
})
export class F5ViewsModule {}
