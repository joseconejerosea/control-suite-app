import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SelectTenantDto } from './dto/select-tenant.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { UserRole } from '../../common/enums/user-role.enum';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // C4 — alta de usuarios reservada a super_admin. Antes era @Public() y
  // aceptaba client_id del body → cualquiera creaba cuentas en cualquier tenant.
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  // Diseño B — el SERVICE_LEAD lista sus agencias asignadas (el SUPERADMIN, todas)
  // para poder elegir la activa. Accesible aun sin tenant activo (ServiceLeadGuard
  // whitelistea esta ruta cuando el SL todavía no seleccionó agencia).
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @Get('my-tenants')
  myTenants(@CurrentUser() user: JwtPayload) {
    return this.authService.getAssignedTenants(user.sub);
  }

  // El SERVICE_LEAD (o el SUPERADMIN, para intervención global) elige la agencia
  // con la que va a operar → se re-emite el JWT con client_id = tenant elegido +
  // marcador activeTenantId.
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.SERVICE_LEAD, UserRole.SUPERADMIN)
  @Post('select-tenant')
  @HttpCode(HttpStatus.OK)
  selectTenant(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SelectTenantDto,
  ) {
    return this.authService.selectTenant(user.sub, dto.tenantId);
  }
}