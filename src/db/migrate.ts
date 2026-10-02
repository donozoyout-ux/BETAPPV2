import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { runMigrations } from './migrator.js';
import { createPool } from './pool.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);

/** Connection-level errors that should NOT block deployment */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code ?? '';
  const msg = error.message ?? '';
  return ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)
    || msg.includes('getaddrinfo')
    || msg.includes('connect ETIMEDOUT')
    || msg.includes('Connection terminated unexpectedly')
    || msg.includes('timeout expired');
}

try {
  await runMigrations(pool);
  logger.info('Database migrations completed');
} catch (error) {
  if (isConnectionError(error)) {
    logger.warn({ err: error },
      'Database unreachable during pre-deploy migration — service will start in DEGRADED mode');
    // Exit 0 so Render proceeds with deploy; the app shows degraded health
  } else {
    logger.fatal({ err: error }, 'Database migration failed');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
