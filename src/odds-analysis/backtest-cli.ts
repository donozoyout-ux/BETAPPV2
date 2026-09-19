import { loadConfig } from '../config.js';
import { OddsAnalysisRepository } from '../db/odds-analysis-repository.js';
import { createPool } from '../db/pool.js';
import { configHash, defaultConfig } from './config.js';
import { runOddsBacktest } from './backtest.js';

const pool = createPool(loadConfig());
const repository = new OddsAnalysisRepository(pool);
try {
  const dataset = await repository.backtestDataset();
  const report = runOddsBacktest(dataset, defaultConfig);
  await repository.saveBacktest(report, defaultConfig, configHash(defaultConfig));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await pool.end();
}
