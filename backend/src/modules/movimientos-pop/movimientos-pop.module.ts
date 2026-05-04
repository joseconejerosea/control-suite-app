import { Module } from '@nestjs/common';
import { MovimientosPopController } from './movimientos-pop.controller';
import { MovimientosPopService } from './movimientos-pop.service';

@Module({
  controllers: [MovimientosPopController],
  providers: [MovimientosPopService],
  exports: [MovimientosPopService],
})
export class MovimientosPopModule {}
