import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';
import { SkipThrottle } from '@nestjs/throttler/dist/throttler.decorator';

@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    try {
      const metrics = await this.metricsService.getMetrics();
      res.status(200).type('text/plain').send(metrics);
    } catch (err) {
      res.status(500).send('Error collecting metrics');
    }
  }
}