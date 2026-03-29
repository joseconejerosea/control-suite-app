import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    //  ENV configuration (global)
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    //  Rate limiting (security)
    ThrottlerModule.forRoot([
      {
        ttl: 60,   // 60 seconds
        limit: 100, // max 100 requests per IP
      },
    ]),

    //  DATABASE CONNECTION 
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,

      ssl: false, 

      autoLoadEntities: true,

      synchronize: false, 

      logging: true, // helpful for debugging
    }),
    UsersModule, 
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}