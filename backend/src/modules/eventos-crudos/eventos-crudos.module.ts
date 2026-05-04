import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueModule } from '../queue/queue.module';
import { EventosCrudosController } from './eventos-crudos.controller';
import { EventoCrudo } from './evento-crudo.entity';
import { EventosCrudosService } from './eventos-crudos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventoCrudo]),
    QueueModule, // provides EventProducer for retry
  ],
  controllers: [EventosCrudosController],
  providers: [EventosCrudosService],
  exports: [EventosCrudosService],
})
export class EventosCrudosModule {}
