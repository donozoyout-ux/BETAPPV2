import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { FootballRepository } from './db/repository.js';
import { OddsAnalysisRepository } from './db/odds-analysis-repository.js';
import { createLogger } from './logger.js';
import { PredictionRepository } from './predictions/service.js';
import { OddsIntelligenceRepository } from './odds-neighbors/repository.js';
import { ControlAuditService } from './control-audit.js';
import { NowgoalLiveOddsRepository } from './db/nowgoal-live-odds-repository.js';

const config = loadConfig();
const logger = createLogger(config, 'betapp-web');
const pool = createPool({ ...config,
  DB_POOL_MAX: Math.min(config.DB_POOL_MAX, 6),
  DB_CONNECT_TIMEOUT: Math.max(config.DB_CONNECT_TIMEOUT, 15_000),
});
const repository = new FootballRepository(pool);
const oddsAnalysis = new OddsAnalysisRepository(pool);
const predictions = new PredictionRepository(pool, config.SUPPORTED_COMPETITIONS);
const oddsIntelligence = new OddsIntelligenceRepository(pool);
const controlAudit = new ControlAuditService(pool, config);
const liveOddsRepository = new NowgoalLiveOddsRepository(pool);
const app = buildApp(config, repository, logger, oddsAnalysis, predictions, oddsIntelligence, controlAudit, liveOddsRepository);

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
