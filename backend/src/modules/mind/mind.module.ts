import { Module } from '@nestjs/common';
import { MindController } from './mind.controller';
import { MindPropuestasService } from './mind-propuestas.service';
import { MindChatService } from './mind-chat.service';
import { MindAnalistaService } from './mind-analista.service';
import { PromptShieldService } from '../../common/ai/prompt-shield.service';

@Module({
  controllers: [MindController],
  providers: [MindPropuestasService, MindChatService, MindAnalistaService, PromptShieldService],
  exports: [MindPropuestasService, MindChatService, MindAnalistaService],
})
export class MindModule {}