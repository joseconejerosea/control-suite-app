import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { MailIngestionService } from './mail-ingestion.service';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

// Escapa texto que se interpola en el HTML de las páginas de callback (evita XSS
// reflejado vía url / mensajes de error / email).
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * OAuth + status para las integraciones de correo, parametrizadas por `:provider`.
 *
 * `/auth/gmail/*` sigue resolviendo EXACTAMENTE igual que antes (provider='gmail')
 * → el redirect URI registrado en Google Cloud no cambia. `/auth/outlook/*` es la
 * ruta nueva. El provider desconocido lo rechaza MailIngestionService.getProvider.
 */
@Controller('auth/:provider')
export class MailController {
  private readonly logger = new Logger(MailController.name);

  constructor(private readonly mail: MailIngestionService) {}

  /**
   * connect AUTENTICADO. El tenant sale del JWT (req.user.client_id), nunca del
   * input. Devuelve { url } con un `state` firmado (CSRF) que liga el flujo OAuth
   * a este client_id. El front lo llama con el bearer y redirige el browser a `url`.
   */
  @Get('connect')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  connect(
    @Param('provider') provider: string,
    @Req() req: FastifyRequest & { user?: { client_id?: string } },
  ) {
    const clientId = req.user?.client_id as string;
    return { url: this.mail.getAuthUrl(provider, clientId) };
  }

  /**
   * callback — DEBE ser @Public(): lo invoca el browser redirigido por el provider,
   * sin JWT. La protección anti-CSRF es el `state` firmado, que handleCallback
   * verifica y del que extrae el client_id (ya no se confía en él como input).
   */
  @Get('callback')
  @Public()
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: FastifyReply,
  ) {
    try {
      const email = await this.mail.handleCallback(provider, code, state);
      res.type('text/html').send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f13;color:#fff">
          <h2 style="color:#2a9d5c">Mailbox Connected!</h2>
          <p>${escapeHtml(email)} is now connected.</p>
        </body></html>
      `);
    } catch (err: any) {
      res.type('text/html').send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f13;color:#fff">
          <h2 style="color:#d63b2f">Connection Failed</h2>
          <p>${escapeHtml(err?.message ?? 'Unknown error')}</p>
        </body></html>
      `);
    }
  }

  /**
   * poll reservado a super_admin (antes @Public → cualquiera disparaba el poll +
   * IA + writes de TODOS los clientes: DoS/costo). Barre TODOS los providers.
   */
  @Post('poll')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  async poll() {
    this.logger.log(`[MailController] Poll all clients started`);
    try {
      await this.mail.pollAllClients();
      this.logger.log(`[MailController] Poll all clients done`);
      return { success: true, message: 'Poll completed for all connected mailboxes.' };
    } catch (err: any) {
      this.logger.error(`[MailController] Poll FAILED: ${err?.message}`, err?.stack);
      return { success: false, error: err?.message ?? 'Unknown error' };
    }
  }

  /** status autenticado y scopeado al tenant del JWT + provider de la ruta. */
  @Get('status')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  async status(
    @Param('provider') provider: string,
    @Req() req: FastifyRequest & { user?: { client_id?: string } },
  ) {
    const clientId = req.user?.client_id as string;
    return this.mail.statusForTenant(clientId, provider);
  }

  /** Desconecta el correo (del provider de la ruta) del tenant del JWT. */
  @Delete('disconnect')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPERADMIN)
  async disconnect(
    @Param('provider') provider: string,
    @Req() req: FastifyRequest & { user?: { client_id?: string } },
  ) {
    const clientId = req.user?.client_id as string;
    return this.mail.disconnectTenant(clientId, provider);
  }
}
