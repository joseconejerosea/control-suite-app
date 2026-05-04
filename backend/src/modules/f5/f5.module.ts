import { Module } from '@nestjs/common';
import { F5Controller } from './f5.controller';
import { ResendEmailService } from '../../common/email/resend.service';

@Module({ controllers: [F5Controller], providers: [ResendEmailService] })
export class F5Module {}
