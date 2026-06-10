import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { F1ReviewService } from './f1-review.service';
import { F1ReviewController } from './f1-review.controller';

@Module({
  imports: [WhatsAppModule],
  controllers: [F1ReviewController],
  providers: [F1ReviewService],
})
export class F1ReviewModule {}
