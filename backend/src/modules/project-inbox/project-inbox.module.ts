import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProjectInboxController } from './project-inbox.controller';
import { ProjectInboxService } from './project-inbox.service';

const QUEUE_PROJECT_INBOX_EXTRACT = 'project-inbox-extract';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_PROJECT_INBOX_EXTRACT }),
  ],
  controllers: [ProjectInboxController],
  providers: [ProjectInboxService],
  exports: [ProjectInboxService],
})
export class ProjectInboxModule {}
