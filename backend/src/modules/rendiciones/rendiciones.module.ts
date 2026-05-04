import { Module } from '@nestjs/common';
import { RendicionesController } from './rendiciones.controller';
import { RendicionesService } from './rendiciones.service';

@Module({
  controllers: [RendicionesController],
  providers: [RendicionesService],
  exports: [RendicionesService],
})
export class RendicionesModule {}
