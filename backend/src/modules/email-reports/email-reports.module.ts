import { Module, Global } from '@nestjs/common';
import { EmailReportsService } from './email-reports.service';

@Global()
@Module({
  providers: [EmailReportsService],
  exports: [EmailReportsService],
})
export class EmailReportsModule {}
