import { loadConfig } from '../config.js';
import { CornerRepository } from '../db/corner-repository.js';
import { createPool } from '../db/pool.js';
import { auditDataset } from './audit.js';

const config = loadConfig();
const pool = createPool(config);
const repository = new CornerRepository(pool);
try {
  const report = auditDataset(await repository.loadHistory(), await repository.auditIntegrity());
  await repository.saveDatasetAudit(report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
