import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProjectResolverService } from './project-resolver.service';
import { ClarificationService } from './clarification.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Global()
@Module({
  imports: [
    WhatsAppModule,
    BullModule.registerQueue({ name: 'ocr' }, { name: 'persist' }),
  ],
  providers: [ProjectResolverService, ClarificationService],
  exports: [ProjectResolverService, ClarificationService],
})
export class ProjectResolverModule {}
