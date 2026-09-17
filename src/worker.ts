import { Collector } from './collector/collector.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { FootballRepository } from './db/repository.js';
import { createLogger } from './logger.js';
import { SofascoreProvider } from './providers/sofascore.js';
import { FotMobProvider } from './providers/fotmob.js';
import { CornerRepository } from './db/corner-repository.js';
import { buildAllLeagueBaselines, buildAllTeamProfiles } from './corners/profiles.js';
import { NowgoalProvider } from './providers/nowgoal.js';
import { OddsRepository } from './db/odds-repository.js';
import { OddsCollector } from './collector/odds-collector.js';

const config = loadConfig();
const logger = createLogger(config, 'betapp-worker');
const pool = createPool(config);
const repository = new FootballRepository(pool);
const cornerRepository = new CornerRepository(pool);
const oddsRepository = new OddsRepository(pool);
const sofascore = new SofascoreProvider(config, logger);
const fotmob = new FotMobProvider(config, logger);
const footballCollectors = [new Collector(sofascore, repository, config, logger),
  ...(config.FOTMOB_ENABLED ? [new Collector(fotmob, repository, config, logger, {
    onStatistics: (match, statistics) => cornerRepository.saveHistorical('fotmob', match, statistics),
    onCycleComplete: async () => {
      const history = await cornerRepository.loadHistory();
      await cornerRepository.saveProfiles(buildAllTeamProfiles(history));
      await cornerRepository.saveBaselines(buildAllLeagueBaselines(history));
    },
  })] : []),
];
const nowgoal = new NowgoalProvider(config, logger);
const oddsCollector = config.NOWGOAL_ENABLED
  ? new OddsCollector(nowgoal, oddsRepository, repository, config, logger)
  : null;
const collectors = [...footballCollectors, ...(oddsCollector ? [oddsCollector] : [])];
let stopped = false;
let wakeSleep: (() => void) | undefined;

function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutdown requested');
  stopped = true;
  for (const collector of collectors) collector.stop();
  wakeSleep?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

async function runCycle(): Promise<void> {
  const results = await Promise.allSettled(footballCollectors.map((collector) => collector.runCycle()));
  for (const result of results) {
    if (result.status === 'rejected') logger.error({ err: result.reason }, 'Football collector cycle failed');
  }
  if (!stopped) {
    try { await oddsCollector?.runCycle(); }
    catch (error) { logger.error({ err: error }, 'Odds collector cycle failed'); }
  }
}

async function waitForNextCycle(): Promise<void> {
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      wakeSleep = undefined;
      resolve();
    };
    const timer = setTimeout(finish, config.COLLECTOR_INTERVAL_MS);
    wakeSleep = finish;
  });
}

try {
  if (process.argv.includes('--once')) await runCycle();
  else if (config.COLLECTOR_ENABLED) {
    while (!stopped) {
      await runCycle();
      if (!stopped) await waitForNextCycle();
    }
  }
  else logger.info('Collector disabled by configuration');
} catch (error) {
  logger.fatal({ err: error }, 'Worker initialization failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
