import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RendicionesController } from './rendiciones.controller';
import { RendicionesService } from './rendiciones.service';

@Module({
  imports: [WhatsAppModule],
  controllers: [RendicionesController],
  providers: [RendicionesService],
  exports: [RendicionesService],
})
export class RendicionesModule {}
