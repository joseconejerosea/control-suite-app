import { Controller, Get, UseGuards } from '@nestjs/common';
import { MovimientosPopService } from '../movimientos-pop/movimientos-pop.service';
import { SkusService } from '../skus/skus.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
@Controller('v1/app')
export class InventarioController {
  constructor(
    private readonly movimientosService: MovimientosPopService,
    private readonly skusService: SkusService,
  ) {}

  @Get('inventario')
  inventarioActual(@CurrentUser() user: JwtPayload) {
    return this.movimientosService.inventarioActual(user.client_id);
  }

  @Get('alertas-stock')
  alertasStock(@CurrentUser() user: JwtPayload) {
    return this.skusService.alertasStock(user.client_id);
  }
}