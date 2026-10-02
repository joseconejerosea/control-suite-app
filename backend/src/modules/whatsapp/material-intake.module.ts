import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MaterialIntakeService } from './material-intake.service';
import { EvidenceIntakeService } from './evidence-intake.service';
import { WhatsAppModule } from './whatsapp.module';
import { SkusModule } from '../skus/skus.module';
import { MovimientosPopModule } from '../movimientos-pop/movimientos-pop.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PendingStaffModule } from '../pending-staff/pending-staff.module';

/**
 * F3 · Intake de material POP + F5 · Intake de evidencia por WhatsApp.
 *
 * @Global (igual que ProjectResolverModule): el webhook (WhatsAppModule) y el
 * OcrProcessor (QueueModule) inyectan MaterialIntakeService/EvidenceIntakeService
 * sin importar este módulo, evitando el ciclo WhatsAppModule ↔ MovimientosPopModule
 * (este último ya importa WhatsAppModule).
 *
 * NotificationsModule + PendingStaffModule are imported here so EvidenceIntakeService
 * can inject NotificationsService and PendingStaffService for the operator-alert
 * block added in Slice C.
 */
@Global()
@Module({
  imports: [
    WhatsAppModule,
    SkusModule,
    MovimientosPopModule,
    BullModule.registerQueue({ name: 'classify' }),
    NotificationsModule,
    PendingStaffModule,
  ],
  providers: [MaterialIntakeService, EvidenceIntakeService],
  exports: [MaterialIntakeService, EvidenceIntakeService],
})
export class MaterialIntakeModule {}
