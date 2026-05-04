import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CanalEntradaController } from './canal-entrada.controller';
import { CanalEntrada } from './canal-entrada.entity';
import { CanalEntradaService } from './canal-entrada.service';

@Module({
  imports: [TypeOrmModule.forFeature([CanalEntrada])],
  controllers: [CanalEntradaController],
  providers: [CanalEntradaService],
  exports: [CanalEntradaService],
})
export class CanalEntradaModule {}
