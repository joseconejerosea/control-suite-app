import { Module } from '@nestjs/common';
import { EquivalenciasController } from './equivalencias.controller';

@Module({ controllers: [EquivalenciasController] })
export class EquivalenciasModule {}
