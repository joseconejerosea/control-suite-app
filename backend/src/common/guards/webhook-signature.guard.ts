import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { CanalEntrada } from '../../modules/canal-entrada/canal-entrada.entity';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawBody: Buffer = request.rawBody;

    if (!rawBody) {
      throw new UnauthorizedException('Invalid request: missing body');
    }

    const canalEntradaId: string | undefined = request.params?.canalEntradaId;
    const isMetaWebhook = !!request.headers['x-hub-signature-256'];

    // For Meta WhatsApp webhooks, use META_APP_SECRET directly
    if (isMetaWebhook) {
      const metaAppSecret = this.configService.get<string>('META_APP_SECRET') ?? '';
      
      const signatureHeader = request.headers['x-hub-signature-256'] as string;
      const receivedSig = signatureHeader.startsWith('sha256=')
        ? signatureHeader.slice(7)
        : signatureHeader;

      const expectedSig = createHmac('sha256', metaAppSecret)
        .update(rawBody)
        .digest('hex');

      let signaturesMatch = false;
      try {
        signaturesMatch = timingSafeEqual(
          Buffer.from(receivedSig, 'hex'),
          Buffer.from(expectedSig, 'hex'),
        );
      } catch {
        signaturesMatch = false;
      }

      if (!signaturesMatch) {
        this.logger.warn(
          `[WebhookSignatureGuard] Meta signature mismatch [canalEntradaId=${canalEntradaId ?? 'N/A'}]`,
        );
        throw new UnauthorizedException('Invalid webhook signature');
      }

      return true;
    }

    // For non-Meta webhooks, use channel secret or global secret
    let secret = this.configService.get<string>('WEBHOOK_SECRET') ?? '';

    if (canalEntradaId) {
      try {
        const repo = this.dataSource.getRepository(CanalEntrada);
        const channel = await repo.findOne({ where: { id: canalEntradaId } });
        const channelSecret = channel?.config?.webhook_secret as string | undefined;
        if (channelSecret) secret = channelSecret;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        this.logger.warn(`[WebhookSignatureGuard] Could not load channel config: ${msg}`);
      }
    }

    const signatureHeader: string =
      request.headers['x-webhook-signature'] ?? '';

    if (!signatureHeader) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const receivedSig = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice(7)
      : signatureHeader;

    const expectedSig = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    let signaturesMatch = false;
    try {
      signaturesMatch = timingSafeEqual(
        Buffer.from(receivedSig, 'hex'),
        Buffer.from(expectedSig, 'hex'),
      );
    } catch {
      signaturesMatch = false;
    }

    if (!signaturesMatch) {
      this.logger.warn(
        `[WebhookSignatureGuard] Signature mismatch [canalEntradaId=${canalEntradaId ?? 'N/A'}]`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}