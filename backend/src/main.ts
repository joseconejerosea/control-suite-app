import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import { ValidationPipe } from '@nestjs/common';
import { FastifyPluginAsync } from 'fastify';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
    }),
  );

  //  Type-safe plugin casting (NO any)
  const helmetPlugin: FastifyPluginAsync = helmet;
  const corsPlugin: FastifyPluginAsync = cors;
  const rateLimitPlugin: FastifyPluginAsync = rateLimit;

  //  Security plugins
  await app.register(helmetPlugin);

  await app.register(corsPlugin, {
    origin: ['http://localhost:3000'],
    credentials: true,
  });

  await app.register(rateLimitPlugin, {
    max: 100,
    timeWindow: '1 minute',
  });

  //  Global API prefix
  app.setGlobalPrefix('api');

  // Global validation (Milestone 2 ready)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  //  Port config
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

  await app.listen(port, '0.0.0.0');

  console.log(` Server running on http://localhost:${port}`);
}

bootstrap();