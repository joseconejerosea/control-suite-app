import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

import helmet = require('@fastify/helmet');
import cors = require('@fastify/cors');
import rateLimit = require('@fastify/rate-limit');

import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(helmet as any);
  await app.register(cors as any, {
    origin: ['http://localhost:3000'],
    credentials: true,
  });
  await app.register(rateLimit as any, {
    max: 100,
    timeWindow: '1 minute',
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(3000, '0.0.0.0');
  console.log(' Server running');
}

bootstrap();