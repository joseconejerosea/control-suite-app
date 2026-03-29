import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filter/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const logger = new Logger('Bootstrap');

  // Security
  app.use(helmet());

  app.enableCors({
    origin: ['http://localhost:3000'], // later move to env
    credentials: true,
  });

  // Global Prefix
  app.setGlobalPrefix('api');

  // Validation (STRICT)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global Exception Filter
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(3000, '0.0.0.0');

  logger.log(` Backend running at http://localhost:3000/api`);
}

bootstrap();