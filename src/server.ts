import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { FootballRepository } from './db/repository.js';
import { OddsAnalysisRepository } from './db/odds-analysis-repository.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config, 'betapp-web');
const pool = createPool(config);
const repository = new FootballRepository(pool);
const oddsAnalysis = new OddsAnalysisRepository(pool);
const app = buildApp(config, repository, logger, oddsAnalysis);

async function shutdown(signal: string) {
  logger.info({ signal }, 'Server shutdown requested');
  await app.close();
  await pool.end();
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  logger.fatal({ err: error }, 'Server failed to start');
  await pool.end();
  process.exitCode = 1;
}
