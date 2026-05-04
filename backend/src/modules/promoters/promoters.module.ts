import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromotersController } from './promoters.controller';
import { PromotersService } from './promoters.service';
import { Promoter } from './entities/promoter.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Promoter])],
  controllers: [PromotersController],
  providers: [PromotersService],
  exports: [PromotersService],
})
export class PromotersModule {}