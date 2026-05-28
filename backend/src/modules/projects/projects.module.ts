import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project]),
    AuthModule,
    ClientsModule,
    WhatsAppModule,
  ],
  controllers: [ProjectsController],
  providers:   [ProjectsService],
  exports:     [ProjectsService],
})
export class ProjectsModule {}
