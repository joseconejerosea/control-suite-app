import { Module } from '@nestjs/common';
import { ProjectInboxController } from './project-inbox.controller';
import { ProjectInboxService } from './project-inbox.service';

@Module({
  controllers: [ProjectInboxController],
  providers: [ProjectInboxService],
  exports: [ProjectInboxService],
})
export class ProjectInboxModule {}
