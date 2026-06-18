import { join } from 'path';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

/**
 * Shared test scaffolding for the tenant-isolation e2e suite.
 * Points at the disposable PG17 cluster stood up in Phase 0.3.
 */
export const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: parseInt(process.env.DB_PORT ?? '5433', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'controlsuite_test',
};

export const JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters-xx';

/** Glob that loads every entity so relations resolve under synchronize:false. */
export const ENTITIES_GLOB = join(__dirname, '..', 'src', '**', '*.entity.ts');

/** Signs a token with the REAL shape: snake_case `client_id` only. */
export function tokenFor(clientId: string, role = 'user'): string {
  return jwt.sign(
    { sub: randomUUID(), email: `user@${clientId}.test`, client_id: clientId, role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

/** Stub so AuthGuard can read JWT_SECRET without the full ConfigModule. */
export const configServiceProvider = {
  provide: ConfigService,
  useValue: { get: (k: string) => (k === 'JWT_SECRET' ? JWT_SECRET : undefined) },
};
