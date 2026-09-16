import { loadConfig } from '../config.js';
import { migrationStatus } from './migrator.js';
import { createPool } from './pool.js';
import { databaseErrorMessage } from './error.js';

const config = loadConfig();
const pool = createPool(config);
try {
  const startedAt = Date.now();
  const status = await migrationStatus(pool);
  console.log(JSON.stringify({ ...status, latencyMs: Date.now() - startedAt }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ connection: 'failed', error: databaseErrorMessage(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end();
}
