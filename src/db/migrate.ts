import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { runMigrations } from './migrator.js';
import { createPool } from './pool.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);

try {
  await runMigrations(pool);
  logger.info('Database migrations completed');
} catch (error) {
  logger.fatal({ err: error }, 'Database migration failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
