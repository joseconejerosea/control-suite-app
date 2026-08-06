import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

// Fase 2 · E6b — datasource de MIGRACIONES (CLI typeorm), independiente del
// runtime (que usa TypeOrmModule en app.module). Las migraciones DDL/RLS deben
// correr con el owner/superusuario; el runtime pasará a un rol sin BYPASSRLS en
// el switch (E6d). Por eso las migraciones usan DB_MIGRATION_* — con fallback a
// DB_* para no cambiar nada hasta el switch.
export const AppDataSource = new DataSource({
  type: 'postgres',

  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_MIGRATION_USERNAME ?? process.env.DB_USERNAME,
  password: process.env.DB_MIGRATION_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  ssl: process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,

  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],

  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});