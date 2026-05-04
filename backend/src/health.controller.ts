import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly configService: ConfigService) {}

  @Get('redis')
  async checkRedis(): Promise<{ status: string }> {
    const client = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
      connectTimeout: 3000,
    });

    try {
      await client.connect();
      const pong = await client.ping();

      if (pong !== 'PONG') {
        throw new Error('Unexpected PING response');
      }

      this.logger.log('[HealthController] Redis ping OK');
      return { status: 'ok' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Redis unreachable';
      this.logger.error(`[HealthController] Redis health check failed: ${msg}`);
      throw new ServiceUnavailableException(`Redis unavailable: ${msg}`);
    } finally {
      client.disconnect();
    }
  }
}
