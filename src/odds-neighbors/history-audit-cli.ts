import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { OddsIntelligenceRepository } from './repository.js';

const arg = process.argv.find((item) => item.startsWith('--limit='));
const parsed = arg ? Number(arg.split('=')[1]) : 5000;
const limit = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 5000;

const pool = createPool(loadConfig());
try {
  const repository = new OddsIntelligenceRepository(pool);
  const [audit, backtest] = await Promise.all([
    repository.historyAudit(limit),
    repository.backtest(),
  ]);
  console.log(JSON.stringify({ audit, backtest }, null, 2));
} finally {
  await pool.end();
}
