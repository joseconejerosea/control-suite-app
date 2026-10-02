import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PendingStaffController } from './pending-staff.controller';
import { PendingStaffService } from './pending-staff.service';
import { PendingStaff } from './entities/pending-staff.entity';

/**
 * Roster-gap queue module.
 *
 * PendingStaffService is exported so Slice C (EvidenceIntakeService wiring)
 * can inject it by importing this module into WhatsAppModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PendingStaff])],
  controllers: [PendingStaffController],
  providers: [PendingStaffService],
  exports: [PendingStaffService],
})
export class PendingStaffModule {}
