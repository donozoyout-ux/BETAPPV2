import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool } = pg;

type PoolConfig = Pick<AppConfig, 'DATABASE_URL' | 'DATABASE_SSL'> & Partial<Pick<AppConfig, 'DB_POOL_MAX' | 'DB_CONNECT_TIMEOUT'>>;

export function createPool(config: PoolConfig) {
  return new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT ?? 5_000,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    application_name: 'betapp-v2',
  });
}

export type DatabasePool = ReturnType<typeof createPool>;
