import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClientActiveGuard } from '../../common/guards/client-active.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { WorkspaceService } from './workspace.service';
import { ClientsService } from '../clients/clients.service';

interface AuthedRequest extends Request {
  user: { id: string; client_id: string; role: string };
}

@Controller('workspace')
@UseGuards(AuthGuard, ClientActiveGuard)
export class WorkspaceController {
  constructor(
    private readonly service: WorkspaceService,
    private readonly clients: ClientsService,
  ) {}

  @Get('context')
  context(@Req() req: AuthedRequest) {
    return this.service.context(req.user.client_id, req.user.id, req.user.role);
  }

  @Get('master-data-status')
  masterDataStatus(@Req() req: AuthedRequest) {
    return this.service.masterDataStatus(req.user.client_id);
  }

  // Self-service de la cuenta (Config → Cuenta): un Manager edita nombre/rut/teléfono de
  // SU propio cliente. El ClientsController es super_admin-only, así que sin esto el botón
  // "Guardar cambios" del panel de cliente daba 403. Whitelist en el service.
  @Patch('account')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  updateAccount(@Req() req: AuthedRequest, @Body() body: any) {
    return this.clients.updateAccount(req.user.client_id, {
      nombre: body?.nombre,
      rut: body?.rut,
      manager_phone: body?.manager_phone ?? body?.config?.manager_phone,
    });
  }

  // ── Agency affiliation code (tenant-scoped: the caller's OWN client only) ────
  // Manager/Superadmin only: the code is a credential the agency hands to its staff.

  @Get('affiliation-code')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  getAffiliationCode(@Req() req: AuthedRequest) {
    return this.clients.getAffiliationCode(req.user.client_id);
  }

  @Post('affiliation-code/rotate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  rotateAffiliationCode(@Req() req: AuthedRequest) {
    return this.clients.rotateAffiliationCode(req.user.client_id);
  }
}