import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CronService } from './cron.service';
import { QUEUE_MIND_PROACTIVE } from '../queue/queue.module';
import { RendicionesModule } from '../rendiciones/rendiciones.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_MIND_PROACTIVE }),
    RendicionesModule,
    WhatsAppModule,
  ],
  providers: [CronService],
})
export class CronModule {}
