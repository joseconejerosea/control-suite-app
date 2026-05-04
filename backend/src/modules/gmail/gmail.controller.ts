import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { GmailService } from './gmail.service';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';

@SkipThrottle()
@Controller('auth/gmail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name);

  constructor(private readonly gmailService: GmailService) {}

  @Get('connect')
  @Public()
  connect(@Res() res: FastifyReply) {
    const url = this.gmailService.getAuthUrl();
    res.type('text/html').send(`
      <html>
        <head><meta http-equiv="refresh" content="0;url=${url}"></head>
        <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f13;color:#fff">
          <p>Redirecting to Google...</p>
          <p><a href="${url}" style="color:#4ade80">Click here if not redirected automatically</a></p>
        </body>
      </html>
    `);
  }

  @Get('callback')
  @Public()
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: FastifyReply) {
    try {
      // state can carry clientId if needed
      await this.gmailService.handleCallback(code, state ?? undefined);
      res.type('text/html').send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f13;color:#fff">
          <h2 style="color:#2a9d5c">Gmail Connected!</h2>
          <p>${process.env.GMAIL_EMAIL} is now connected.</p>
        </body></html>
      `);
    } catch (err: any) {
      res.type('text/html').send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f13;color:#fff">
          <h2 style="color:#d63b2f">Connection Failed</h2>
          <p>${err?.message ?? 'Unknown error'}</p>
        </body></html>
      `);
    }
  }

  @Post('poll')
  @Public()
  @HttpCode(HttpStatus.OK)
  async poll() {
    this.logger.log(`[GmailController] Poll all clients started`);
    try {
      await this.gmailService.pollAllClients();
      this.logger.log(`[GmailController] Poll all clients done`);
      return {
        success: true,
        message: 'Poll completed for all connected clients.',
      };
    } catch (err: any) {
      this.logger.error(`[GmailController] Poll FAILED: ${err?.message}`, err?.stack);
      return {
        success: false,
        error: err?.message ?? 'Unknown error',
      };
    }
  }

  @Get('status')
  @Public()
  async status() {
    const email = process.env.GMAIL_EMAIL ?? null;
    const tokens = email ? await this.gmailService.loadTokensForClient(email) : null;
    const connected = !!tokens;
    return {
      connected,
      email,
      message: connected
        ? 'Gmail is connected.'
        : 'Gmail not connected. Visit /api/auth/gmail/connect to authorize.',
    };
  }
}