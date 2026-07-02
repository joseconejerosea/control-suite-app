import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { MovimientosPopService } from './movimientos-pop.service';
import { CreateMovimientoDto, MovimientoFiltersDto } from './dto/movimiento-pop.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
@Controller('v1/app/movimientos')
export class MovimientosPopController {
  constructor(private readonly svc: MovimientosPopService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() filters: MovimientoFiltersDto) {
    return this.svc.findAll(user.client_id, filters);
  }

  @Get('analisis-merma')
  merma(@CurrentUser() user: JwtPayload) {
    return this.svc.analisisMerma30Dias(user.client_id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.client_id, id);
  }

  @Post('manual')
  @AuditAction({ action: 'CREATE_STOCK_MOVEMENT', entity: 'MovimientoPop' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateMovimientoDto) {
    return this.svc.create(user.client_id, dto);
  }
}