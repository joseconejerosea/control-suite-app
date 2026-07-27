import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ClientIsolationGuard } from './common/guards/client-isolation.guard';
import { AuthGuard } from './common/guards/auth.guard';
import { ServiceLeadGuard } from './common/guards/service-lead.guard';
import { ServiceLeadTenant } from './modules/auth/entities/service-lead-tenant.entity';

import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { LocationsModule } from './modules/locations/locations.module';
import { PromotersModule } from './modules/promoters/promoters.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { ActivationsModule } from './modules/activations/activations.module';
import { CanalEntradaModule } from './modules/canal-entrada/canal-entrada.module';
import { EventosCrudosModule } from './modules/eventos-crudos/eventos-crudos.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthController } from './health.controller';
import { ClientsModule } from './modules/clients/clients.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { CollaboratorsModule } from './modules/collaborators/collaborators.module';
import { DocumentIngestionModule } from './modules/document-ingestion/document-ingestion.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { GmailModule } from './modules/gmail/gmail.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { RendicionesModule } from './modules/rendiciones/rendiciones.module';
import { BodegasModule } from './modules/bodegas/bodegas.module';
import { SkusModule } from './modules/skus/skus.module';
import { MovimientosPopModule } from './modules/movimientos-pop/movimientos-pop.module';
import { InventarioModule } from './modules/inventario/inventario.module';
import { MindModule } from './modules/mind/mind.module';
import { EquivalenciasModule } from './modules/equivalencias/equivalencias.module';
import { F5Module } from './modules/f5/f5.module';
import { F5ViewsModule } from './modules/f5-views/f5-views.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { MaterialIntakeModule } from './modules/whatsapp/material-intake.module';
import { CronModule } from './modules/cron/cron.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { AuditModule } from './modules/audit/audit.module';
import { StorageModule } from './common/storage/storage.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { ProjectResolverModule } from './modules/project-resolver/project-resolver.module';
import { F1ReviewModule } from './modules/f1-review/f1-review.module';
import { ProjectInboxModule } from './modules/project-inbox/project-inbox.module';
import { SupportModule } from './modules/support/support.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host:     config.get<string>('DB_HOST'),
        port:     config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        entities:   [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        ssl: config.get('NODE_ENV') === 'production' || config.get('DB_SSL') === 'true'
          ? { rejectUnauthorized: false }
          : false,
        synchronize: false,
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: config.get<number>('THROTTLE_TTL', 60), limit: config.get<number>('THROTTLE_LIMIT', 100) }],
      }),
    }),

    // Repo del guard global ServiceLeadGuard (APP_GUARD). Se registra en el
    // injector raíz para que el guard pueda inyectar el repositorio.
    TypeOrmModule.forFeature([ServiceLeadTenant]),

    UsersModule, AuthModule, LocationsModule, PromotersModule,
    CampaignsModule, ActivationsModule, CanalEntradaModule,
    EventosCrudosModule, WebhooksModule, QueueModule,
    ClientsModule, OnboardingModule, ProjectsModule,
    CollaboratorsModule, DocumentIngestionModule, DashboardModule,
    WorkspaceModule, InvoicesModule, GmailModule, MetricsModule,

    RendicionesModule, BodegasModule, SkusModule,
    MovimientosPopModule, InventarioModule, MindModule,

    EquivalenciasModule,
    F5Module,
    F5ViewsModule,
    WhatsAppModule,
    MaterialIntakeModule,
    CronModule,
    MonitoringModule,
    AuditModule,
    StorageModule,
    ProjectResolverModule,
    F1ReviewModule,
    ProjectInboxModule,
    SupportModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global AuthGuard — runs first, decodes JWT, respects @Public()
    { provide: APP_GUARD, useClass: AuthGuard },
    // ServiceLeadGuard — corre DESPUÉS de AuthGuard (necesita req.user).
    // Sólo el SERVICE_LEAD paga costo de DB; valida el tenant activo (Diseño B).
    { provide: APP_GUARD, useClass: ServiceLeadGuard },
    // Brief Rule 09: isolation check runs after user is set
    { provide: APP_GUARD, useClass: ClientIsolationGuard },
    // Tenant binding (Fase 2 · E4a) — el MÁS externo: abre la tx con
    // app.current_tenant antes que cualquier otro interceptor (incl. audit).
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}