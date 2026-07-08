import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { GmailService } from './gmail.service';
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

@Controller('auth/gmail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name);

  constructor(private readonly gmailService: GmailService) {}

  /**
   * C3 — connect AUTENTICADO. El tenant sale del JWT (req.user.client_id), nunca
   * del input. Devuelve { url } con un `state` firmado (CSRF) que liga este flujo
   * OAuth a este client_id. El frontend debe llamarlo con el bearer y luego
   * redirigir el browser a `url`.
   */
  @Get('connect')
  connect(@Req() req: FastifyRequest & { user?: { client_id?: string } }) {
    const clientId = req.user?.client_id as string;
    return { url: this.gmailService.getAuthUrl(clientId) };
  }

  /**
   * callback — DEBE ser @Public(): lo invoca el browser redirigido por Google,
   * sin JWT. La protección anti-CSRF es el `state` firmado, que handleCallback
   * verifica y del que extrae el client_id (ya no se confía en él como input).
   */
  @Get('callback')
  @Public()
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: FastifyReply,
  ) {
    try {
      const email = await this.gmailService.handleCallback(code, state);
      res.type('text/html').send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f13;color:#fff">
          <h2 style="color:#2a9d5c">Gmail Connected!</h2>
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
   * C3 / H12 — poll reservado a super_admin. Antes era @Public() → cualquiera
   * disparaba el poll + extracción IA + writes de TODOS los clientes (DoS/costo).
   */
  @Post('poll')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  async poll() {
    this.logger.log(`[GmailController] Poll all clients started`);
    try {
      await this.gmailService.pollAllClients();
      this.logger.log(`[GmailController] Poll all clients done`);
      return { success: true, message: 'Poll completed for all connected clients.' };
    } catch (err: any) {
      this.logger.error(`[GmailController] Poll FAILED: ${err?.message}`, err?.stack);
      return { success: false, error: err?.message ?? 'Unknown error' };
    }
  }

  /**
   * C3 / H12 — status autenticado y scopeado al tenant del JWT. Antes era
   * @Public() y filtraba el GMAIL_EMAIL global.
   */
  @Get('status')
  async status(@Req() req: FastifyRequest & { user?: { client_id?: string } }) {
    const clientId = req.user?.client_id as string;
    return this.gmailService.statusForTenant(clientId);
  }

  /**
   * Desconecta Gmail del tenant del JWT (borra sus tokens OAuth). Autenticado y
   * scopeado al client_id del request — nunca a un tenant arbitrario del input.
   */
  @Delete('disconnect')
  async disconnect(@Req() req: FastifyRequest & { user?: { client_id?: string } }) {
    const clientId = req.user?.client_id as string;
    return this.gmailService.disconnectTenant(clientId);
  }
}
