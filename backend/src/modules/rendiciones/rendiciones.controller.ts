import {
  Controller, Get, Patch, Param, Body, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { RendicionesService } from './rendiciones.service';
import { RechazarRendicionDto, MarcarPagadaDto, RendicionFiltersDto } from './dto/rendicion.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@Controller('rendiciones')
@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard)
export class RendicionesController {
  constructor(private readonly svc: RendicionesService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() filters: RendicionFiltersDto) {
    return this.svc.findAll(user.client_id, filters);
  }

  @Get('kpis')
  kpis(@CurrentUser() user: JwtPayload) {
    return this.svc.kpis(user.client_id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findOne(user.client_id, id);
  }

  @Get(':id/items')
  async getItems(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const detalle = await this.svc.findOne(user.client_id, id);
    return detalle.items ?? [];
  }

  @Patch(':id/cerrar')
  @HttpCode(HttpStatus.OK)
  cerrar(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cerrarManual(user.client_id, id);
  }

  @Patch(':id/aprobar')
  @HttpCode(HttpStatus.OK)
  aprobar(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.aprobar(user.client_id, id, user.sub);
  }

  @Patch(':id/rechazar')
  @HttpCode(HttpStatus.OK)
  rechazar(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarRendicionDto,
  ) {
    return this.svc.rechazar(user.client_id, id, dto);
  }

  @Patch(':id/marcar-pagada')
  @HttpCode(HttpStatus.OK)
  marcarPagada(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarcarPagadaDto,
  ) {
    return this.svc.marcarPagada(user.client_id, id, dto);
  }
}