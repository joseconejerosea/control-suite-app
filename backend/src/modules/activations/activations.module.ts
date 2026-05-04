import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivationsController } from './activations.controller';
import { ActivationsService } from './activations.service';
import { Activation } from './entities/activation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Activation])],
  controllers: [ActivationsController],
  providers: [ActivationsService],
  exports: [ActivationsService],
})
export class ActivationsModule {}