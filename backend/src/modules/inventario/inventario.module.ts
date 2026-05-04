import { Module } from '@nestjs/common';
import { InventarioController } from './inventario.controller';
import { MovimientosPopModule } from '../movimientos-pop/movimientos-pop.module';
import { SkusModule } from '../skus/skus.module';

@Module({
  imports: [MovimientosPopModule, SkusModule],
  controllers: [InventarioController],
})
export class InventarioModule {}
