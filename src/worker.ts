import { Collector } from './collector/collector.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { FootballRepository } from './db/repository.js';
import { createLogger } from './logger.js';
import { SofascoreProvider } from './providers/sofascore.js';
import { FotMobProvider } from './providers/fotmob.js';
import { CornerRepository } from './db/corner-repository.js';
import { OddsAnalysisRepository } from './db/odds-analysis-repository.js';
import { buildAllLeagueBaselines, buildAllTeamProfiles } from './corners/profiles.js';

const config = loadConfig();
const logger = createLogger(config, 'betapp-worker');
const pool = createPool(config);
const repository = new FootballRepository(pool);
const cornerRepository = new CornerRepository(pool);
const oddsAnalysisRepository = new OddsAnalysisRepository(pool);
const sofascore = new SofascoreProvider(config, logger);
const fotmob = new FotMobProvider(config, logger);
async function refreshOddsAnalysis() {
  try {
    const result = await oddsAnalysisRepository.analyzeUpcoming();
    logger.info(result, 'ODDS_V1 analysis refresh completed');
  } catch (error) {
    logger.warn({ err: error }, 'ODDS_V1 analysis refresh failed; collector remains active');
  }
}

const collectors = [new Collector(sofascore, repository, config, logger, { onCycleComplete: refreshOddsAnalysis }),
  ...(config.FOTMOB_ENABLED ? [new Collector(fotmob, repository, config, logger, {
    onStatistics: (match, statistics) => cornerRepository.saveHistorical('fotmob', match, statistics),
    onCycleComplete: async () => {
      const history = await cornerRepository.loadHistory();
      await cornerRepository.saveProfiles(buildAllTeamProfiles(history));
      await cornerRepository.saveBaselines(buildAllLeagueBaselines(history));
      await refreshOddsAnalysis();
    },
  })] : []),
];

function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutdown requested');
  for (const collector of collectors) collector.stop();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

try {
  if (process.argv.includes('--once')) await Promise.all(collectors.map((collector) => collector.runCycle()));
  else if (config.COLLECTOR_ENABLED) await Promise.all(collectors.map((collector) => collector.runForever()));
  else logger.info('Collector disabled by configuration');
} catch (error) {
  logger.fatal({ err: error }, 'Worker initialization failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
