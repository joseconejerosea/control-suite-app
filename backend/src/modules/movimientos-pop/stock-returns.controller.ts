import { Controller, Get, Put, Param, Body, UseGuards, ParseUUIDPipe, Req } from '@nestjs/common';
import { StockReturnsService } from './stock-returns.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientIsolationGuard } from '../../common/guards/client-isolation.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { FastifyRequest } from 'fastify';

@UseGuards(AuthGuard, ClientIsolationGuard, ClientActiveGuard, RolesGuard)
@Controller('v1/app/stock/returns')
export class StockReturnsController {
  constructor(private readonly svc: StockReturnsService) {}

  @Get('pending')
  @Roles('admin_cliente', 'super_admin', 'user')
  findPending(@CurrentUser() user: JwtPayload) {
    return this.svc.findPending(user.client_id);
  }

  @Put(':id/confirm')
  @Roles('admin_cliente', 'super_admin')
  @AuditAction({ action: 'CONFIRM_RETURN', entity: 'stock_return_requests' })
  confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.confirm(user.client_id, id, user.sub, req.ip);
  }

  @Put(':id/reject')
  @Roles('admin_cliente', 'super_admin')
  @AuditAction({ action: 'REJECT_RETURN', entity: 'stock_return_requests' })
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.reject(user.client_id, id, user.sub, reason ?? '', req.ip);
  }
}
