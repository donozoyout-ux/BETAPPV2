import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { PredictionRepository } from './service.js';

const appConfig = loadConfig();
const pool = createPool(appConfig);

try {
  const repository = new PredictionRepository(pool);
  const [global, segments, rootCauses] = await Promise.all([
    repository.runSelfAudit(),
    repository.runSegmentSelfAudit(),
    repository.runRootCauseAudit(),
  ]);
  console.log(JSON.stringify({ global, segments, rootCauses }, null, 2));
} finally {
  await pool.end();
}
