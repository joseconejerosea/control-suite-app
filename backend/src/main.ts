import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { FastifyInstance } from 'fastify';
import { HttpExceptionFilter } from './common/filter/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { SanitizeInputPipe } from './common/pipes/sanitize-input.pipe';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true },
  );

  app.enableShutdownHooks();

  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);
  const fastifyInstance = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  
  await fastifyInstance.register(helmet);
  await fastifyInstance.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  app.enableCors({
    origin: configService.get<string>('ALLOWED_ORIGIN'),
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new SanitizeInputPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new LoggingInterceptor(),
    new ResponseInterceptor(),
  );

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`Backend running at http://localhost:${port}/api`);
}

bootstrap();