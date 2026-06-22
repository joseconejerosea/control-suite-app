import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

// C6 — /metrics expone labels client_id de TODOS los tenants (enumeración +
// volumen de negocio). Reservado a super_admin.
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
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