import { Module, Global } from '@nestjs/common';
import { PromptShieldService } from './prompt-shield.service';

@Global()
@Module({
  providers: [PromptShieldService],
  exports: [PromptShieldService],
})
export class PromptShieldModule {}
