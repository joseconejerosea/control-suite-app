import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { WebhookSignatureGuard } from '../../common/guards/webhook-signature.guard';
import { WebhooksService } from './webhooks.service';
import { Public } from '../../common/decorators/public.decorator';
import { constantTimeEqual } from '../../common/utils/constant-time';

interface FastifyRequestWithRawBody extends FastifyRequest {
  rawBody: Buffer;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Get('ingest/:canalEntradaId')
  @HttpCode(HttpStatus.OK)
  verify(
    @Param('canalEntradaId') canalEntradaId: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() reply: FastifyReply,
  ) {
    const verifyToken = process.env.WEBHOOK_SECRET;
    if (!verifyToken) {
      // fail-closed: sin secreto configurado no validamos contra un literal
      reply.status(403).send('Forbidden');
      return;
    }
    if (mode === 'subscribe' && constantTimeEqual(token, verifyToken)) {
      reply.status(200).send(challenge);
    } else {
      reply.status(403).send('Forbidden');
    }
  }

  @Public()
  @Post('ingest/:canalEntradaId')
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(
    @Param('canalEntradaId', ParseUUIDPipe) canalEntradaId: string,
    @Req() request: FastifyRequestWithRawBody,
  ): Promise<Record<string, unknown>> {
    const rawBody = request.rawBody;
    const headers = request.headers as Record<string, string>;
    return this.webhooksService.ingest(canalEntradaId, rawBody, headers);
  }
}