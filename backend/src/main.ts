import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { FastifyInstance } from 'fastify';
import { HttpExceptionFilter } from './common/filter/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { SanitizeInputPipe } from './common/pipes/sanitize-input.pipe';
import { winstonLogger } from './common/logger/winston.config';
import { DataSource } from 'typeorm';
import { installTenantQueryRouting, setSystemDataSource } from './common/tenant/tenant-context';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true, logger: winstonLogger },
  );

  app.enableShutdownHooks();

  // Fase 2 · E4b — rutea todo ds.query(...) al QueryRunner con el tenant seteado
  // (vía el TenantInterceptor / runWithTenant). Sin contexto, usa la conexión
  // normal (arranque, migraciones, jobs que aún no envuelven runWithTenant).
  installTenantQueryRouting(app.get(DataSource));

  const logger = winstonLogger;
  const configService = app.get(ConfigService);

  // Fase 2 · E4c (Gap 3) — pool de sistema (rol con BYPASSRLS) para runAsSystem:
  // operaciones cross-tenant legítimas (resolución de webhooks, barridas de cron,
  // expiraciones). Si DB_SYSTEM_* no están seteadas, usa las credenciales normales
  // (válido hasta E6, donde DB_USERNAME pasa a un rol sin BYPASSRLS).
  const isProd = configService.get('NODE_ENV') === 'production';
  const systemDataSource = new DataSource({
    type: 'postgres',
    host: configService.get<string>('DB_HOST'),
    port: configService.get<number>('DB_PORT'),
    username: configService.get<string>('DB_SYSTEM_USERNAME') ?? configService.get<string>('DB_USERNAME'),
    password: configService.get<string>('DB_SYSTEM_PASSWORD') ?? configService.get<string>('DB_PASSWORD'),
    database: configService.get<string>('DB_NAME'),
    ssl: isProd || configService.get('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
    synchronize: false,
    extra: { max: 4 }, // pool chico: solo operaciones de sistema
  });
  await systemDataSource.initialize();
  setSystemDataSource(systemDataSource);
  // El systemDataSource es standalone (no es un provider de Nest), así que lo
  // cerramos a mano en las señales de cierre. `enableShutdownHooks()` (arriba)
  // ya cierra grácilmente la app de Nest; esto solo libera este pool extra.
  const closeSystemDataSource = async () => {
    if (systemDataSource.isInitialized) await systemDataSource.destroy();
  };
  process.once('SIGTERM', closeSystemDataSource);
  process.once('SIGINT', closeSystemDataSource);

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