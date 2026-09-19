import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { PredictionRepository } from './service.js';

const appConfig = loadConfig();
const pool = createPool(appConfig);

try {
  const repository = new PredictionRepository(pool);
  const report = await repository.runSelfAudit();
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
