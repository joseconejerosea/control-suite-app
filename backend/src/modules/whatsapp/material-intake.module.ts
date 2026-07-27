import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MaterialIntakeService } from './material-intake.service';
import { WhatsAppModule } from './whatsapp.module';
import { SkusModule } from '../skus/skus.module';
import { MovimientosPopModule } from '../movimientos-pop/movimientos-pop.module';

/**
 * F3 · Intake de material POP por WhatsApp.
 *
 * @Global (igual que ProjectResolverModule): el webhook (WhatsAppModule) y el
 * OcrProcessor (QueueModule) inyectan MaterialIntakeService sin importar este
 * módulo, evitando el ciclo WhatsAppModule ↔ MovimientosPopModule (este último
 * ya importa WhatsAppModule).
 */
@Global()
@Module({
  imports: [
    WhatsAppModule,
    SkusModule,
    MovimientosPopModule,
    BullModule.registerQueue({ name: 'classify' }),
  ],
  providers: [MaterialIntakeService],
  exports: [MaterialIntakeService],
})
export class MaterialIntakeModule {}
