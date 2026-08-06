import { Module } from '@nestjs/common';
import { MovimientosPopController } from './movimientos-pop.controller';
import { MovimientosPopService } from './movimientos-pop.service';
import { StockReturnsController } from './stock-returns.controller';
import { StockReturnsService } from './stock-returns.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsAppModule],
  controllers: [MovimientosPopController, StockReturnsController],
  providers: [MovimientosPopService, StockReturnsService],
  exports: [MovimientosPopService, StockReturnsService],
})
export class MovimientosPopModule {}
