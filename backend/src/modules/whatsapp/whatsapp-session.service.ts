import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface WhatsAppSession {
  state: string;
  projects: { id: string; name: string }[];
  base64: string;
  mimeType: string;
  caption: string;
  clientId: string | null;
  canalId: string | null;
  lastProjectId?: string | null;
  updatedAt: string;
  // Clarification flow
  clarification?: {
    eventoCrudoId: string;
    type: 'project' | 'data';
    attempts: number;
    pendingFields?: string[];
    collected?: Record<string, string>;
    options?: { id: string; label: string }[];
  } | null;
}

const PREFIX = 'wa:session:';
const TTL_SECONDS = 4 * 60 * 60; // 4 hours

@Injectable()
export class WhatsAppSessionService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppSessionService.name);
  private redis: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    if (url) {
      this.redis = new Redis(url, { maxRetriesPerRequest: null });
    } else {
      this.redis = new Redis({
        host: this.config.get<string>('REDIS_HOST'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        tls: this.config.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
        maxRetriesPerRequest: null,
      });
    }
    this.logger.log('WhatsApp session store initialized (Redis)');
  }

  async get(phoneNumber: string): Promise<WhatsAppSession | null> {
    const data = await this.redis.get(`${PREFIX}${phoneNumber}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(phoneNumber: string, session: WhatsAppSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await this.redis.set(
      `${PREFIX}${phoneNumber}`,
      JSON.stringify(session),
      'EX',
      TTL_SECONDS,
    );
  }

  async delete(phoneNumber: string): Promise<void> {
    await this.redis.del(`${PREFIX}${phoneNumber}`);
  }

  async updateLastProject(phoneNumber: string, projectId: string): Promise<void> {
    const session = await this.get(phoneNumber);
    if (session) {
      session.lastProjectId = projectId;
      await this.set(phoneNumber, session);
    }
  }
}
