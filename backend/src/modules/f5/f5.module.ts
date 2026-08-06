import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { F5Controller } from './f5.controller';
import { ResendEmailService } from '../../common/email/resend.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'report-gen' }),
    WhatsAppModule,
  ],
  controllers: [F5Controller],
  providers: [ResendEmailService],
})
export class F5Module {}
