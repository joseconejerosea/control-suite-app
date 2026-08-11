import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from './client.entity';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { AffiliationCodeService } from './affiliation-code.service';
import { AffiliationService } from './affiliation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Client])],
  controllers: [ClientsController],
  providers: [ClientsService, AffiliationCodeService, AffiliationService],
  // AffiliationCodeService + AffiliationService are exported so the WhatsApp inbound
  // flow can resolve an agency by the code a sender types and affiliate them.
  exports: [ClientsService, AffiliationCodeService, AffiliationService, TypeOrmModule],
})
export class ClientsModule {}
