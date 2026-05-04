import { Module } from '@nestjs/common';
import { F5ViewController } from './f5-views.controller';

@Module({ controllers: [F5ViewController] })
export class F5ViewsModule {}
