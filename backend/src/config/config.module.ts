import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().default(5432),
        DB_USERNAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_NAME: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('8h'),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
        PORT: Joi.number().default(3000),
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        ALLOWED_ORIGIN: Joi.string().required(),
        WEBHOOK_SECRET: Joi.string().required(),
        // ── Redis / BullMQ (M3) ──────────────────────────────────────────
        REDIS_HOST: Joi.string().required(),
        REDIS_PORT: Joi.number().default(6379),
        REDIS_PASSWORD: Joi.string().allow('').default(''),
        // ── AI Configuration (H5 — optional, app works without it) ───────
        AI_PROVIDER: Joi.string().valid('openai', 'anthropic').default('openai'),
        AI_API_KEY: Joi.string().allow('').optional(),
        AI_MODEL: Joi.string().default('gpt-4o-mini'),
        AI_MAX_TOKENS: Joi.number().default(4096),
        // ── Supabase Storage ─────────────────────────────────────────────
        SUPABASE_URL: Joi.string().allow('').optional(),
        SUPABASE_SERVICE_ROLE_KEY: Joi.string().allow('').optional(),
        // ── File Upload (H5) ─────────────────────────────────────────────
        UPLOAD_MAX_SIZE_MB: Joi.number().default(10),
        UPLOAD_DIR: Joi.string().default('./uploads'),
      }),
      validationOptions: {
        abortEarly: true,
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}