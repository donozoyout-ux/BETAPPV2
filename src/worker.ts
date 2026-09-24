import { LiveRepository } from './live/repository.js';
import { SecondaryLiveRefresh } from './live/secondary-refresh.js';
import { ApiFootballProvider } from './providers/api-football.js';
import { fotmobEvents, fotmobClock, fotmobPhase } from './live/events.js';
import { LiveRefresh } from './live/refresh.js';
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
import { ApiFootballPrematchOddsCollector } from './collector/api-football-odds-collector.js';
import { PredictionRepository, PredictionService } from './predictions/service.js';
import { ControlAuditService } from './control-audit.js';
import { CompetitionAutoBackfill } from './historical/competition-auto-backfill.js';
import { HistoricalRepository } from './db/historical-repository.js';
import { PublicCsvImportRepository } from './historical/public-csv-repository.js';
import { PublicCsvHistoricalImporter } from './historical/public-csv-importer.js';
import { OpenFootballImportRepository } from './historical/openfootball-repository.js';
import { OpenFootballHistoricalImporter } from './historical/openfootball-importer.js';
import { StageHistoricalRepository } from './predictions/stage-history-repository.js';

const config = loadConfig();
const logger = createLogger(config, 'betapp-worker');
const pool = createPool({ ...config,
  DB_POOL_MAX: Math.min(config.DB_POOL_MAX, 4),
  DB_CONNECT_TIMEOUT: Math.max(config.DB_CONNECT_TIMEOUT, 15_000),
});
const repository = new FootballRepository(pool);
const cornerRepository = new CornerRepository(pool);
const oddsRepository = new OddsRepository(pool, (error, matchId) => {
  logger.warn({ err: error, matchId }, 'ODDS_V1 analysis failed after odds persistence; continuing');
});
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
const predictionRepository = new PredictionRepository(pool, config.SUPPORTED_COMPETITIONS);
const predictionService = new PredictionService(predictionRepository);
const controlAudit = new ControlAuditService(pool, config);
const competitionAutoBackfill = new CompetitionAutoBackfill(pool, config, fotmob, logger);
const historicalRepository = new HistoricalRepository(pool);
const publicCsvImportRepository = new PublicCsvImportRepository(pool);
const publicCsvImporter = new PublicCsvHistoricalImporter(
  config, repository, historicalRepository, publicCsvImportRepository, predictionRepository, logger,
);
const openFootballImportRepository = new OpenFootballImportRepository(pool);
const openFootballImporter = new OpenFootballHistoricalImporter(
  config, repository, historicalRepository, openFootballImportRepository, logger,
);
const stageHistoricalRepository = new StageHistoricalRepository(pool, logger, config.PUBLIC_CSV_IMPORT_INTERVAL_MS);
const collectors = [...footballCollectors, ...(oddsCollector ? [oddsCollector] : [])];
const liveRepository = new LiveRepository(pool);
const apiFootball = new ApiFootballProvider(config);
const secondaryRefresh = new SecondaryLiveRefresh(apiFootball, liveRepository, config, logger);
const apiFootballOddsCollector = new ApiFootballPrematchOddsCollector(
  apiFootball, oddsRepository, repository, config, logger,
);
const liveRefresh = config.FOTMOB_ENABLED ? new LiveRefresh(fotmob, repository, logger, async (match, id, stats) => {
  const payload = await fotmob.details(match.providerExternalId);
  const observedAt = stats.sourceUpdatedAt.toISOString();
  await liveRepository.save(id, {
    snapshot: { provider: 'fotmob', externalId: match.providerExternalId, status: match.status,
      phase: fotmobPhase(payload.header?.status),
      homeScore: match.homeScore, awayScore: match.awayScore, ...fotmobClock(payload.header?.status),
      observedAt: match.sourceUpdatedAt.toISOString() },
    events: fotmobEvents(payload, id, observedAt), statistics: null, odds: null, detailsAt: observedAt,
  });
}) : null;
let secondaryTask: Promise<void> | undefined;
let liveTask: Promise<void> | undefined;
let competitionBackfillTask: Promise<void> | undefined;
let apiFootballOddsTask: Promise<void> | undefined;
let publicCsvImportTask: Promise<void> | undefined;
let openFootballImportTask: Promise<void> | undefined;
let stageHistoricalTask: Promise<void> | undefined;
let stopped = false;
let wakeSleep: (() => void) | undefined;

function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutdown requested');
  stopped = true;
  liveRefresh?.stop();
  secondaryRefresh.stop();
  competitionAutoBackfill.stop();
  apiFootballOddsCollector.stop();
  publicCsvImporter.stop();
  openFootballImporter.stop();
  stageHistoricalRepository.stop();
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
    try { await predictionRepository.settlePending(); }
    catch (error) { logger.error({ err: error }, 'Prediction settlement failed; continuing'); }
  }
  if (!stopped) {
    try {
      const audit = await predictionRepository.runSelfAudit();
      logger.info({ status: audit.status, recentN: audit.recentSampleSize, lossStreak: audit.lossStreak },
        'Prediction self audit completed');
    }
    catch (error) { logger.error({ err: error }, 'Prediction self audit failed; continuing'); }
  }
  if (!stopped) {
    try {
      const segments = await predictionRepository.runSegmentSelfAudit();
      logger.info({
        segments: segments.length,
        paused: segments.filter((item) => item.status === 'PAUSED' && item.guardActive).length,
        watch: segments.filter((item) => item.status === 'WATCH').length,
      }, 'Prediction segmented self audit completed');
    }
    catch (error) { logger.error({ err: error }, 'Prediction segmented self audit failed; continuing'); }
  }
  if (!stopped) {
    try {
      const factors = await predictionRepository.runRootCauseAudit();
      logger.info({
        factors: factors.length,
        highRisk: factors.filter((item) => item.status === 'HIGH_RISK').length,
        watch: factors.filter((item) => item.status === 'WATCH').length,
      }, 'Prediction root cause self audit completed');
    }
    catch (error) { logger.error({ err: error }, 'Prediction root cause self audit failed; continuing'); }
  }
  if (!stopped) {
    try {
      const proposals = await predictionRepository.runAdaptiveRuleProposals();
      logger.info({
        proposals: proposals.length,
        highRisk: proposals.filter((item) => item.severity === 'HIGH_RISK').length,
        pending: proposals.filter((item) => item.decision === 'PROPOSED').length,
      }, 'Prediction adaptive rule proposals refreshed');
    }
    catch (error) { logger.error({ err: error }, 'Prediction adaptive rule proposal refresh failed; continuing'); }
  }
  if (!stopped) {
    try { await predictionRepository.refreshHistoricalIncremental(); }
    catch (error) { logger.error({ err: error }, 'Prediction historical refresh failed; continuing'); }
  }
  if (!stopped) {
    try { await oddsCollector?.runCycle(); }
    catch (error) { logger.error({ err: error }, 'Odds collector cycle failed'); }
  }
  if (!stopped) {
    try { await predictionService.refreshPreviewsAndLocks(); }
    catch (error) { logger.error({ err: error }, 'Prediction preview/lock cycle failed; continuing'); }
  }
  if (!stopped) {
    try {
      const audit = await controlAudit.run();
      logger.info({ status: audit.status, version: audit.version }, 'Control audit completed');
    } catch (error) {
      logger.error({ err: error }, 'Control audit failed; continuing');
    }
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
  if (process.argv.includes('--once')) {
    await runCycle();
    await secondaryRefresh.runCycle();
    if (apiFootballOddsCollector.enabled()) await apiFootballOddsCollector.runCycle();
    if (competitionAutoBackfill.enabled()) await competitionAutoBackfill.runNext();
    if (publicCsvImporter.enabled()) await publicCsvImporter.runCycle();
    if (openFootballImporter.enabled()) await openFootballImporter.runCycle();
    await stageHistoricalRepository.runNext();
  }
  else if (config.COLLECTOR_ENABLED) {
    liveTask = liveRefresh?.runForever();
    secondaryTask = secondaryRefresh.runForever();
    competitionBackfillTask = competitionAutoBackfill.runForever();
    apiFootballOddsTask = apiFootballOddsCollector.runForever();
    publicCsvImportTask = publicCsvImporter.runForever();
    openFootballImportTask = openFootballImporter.runForever();
    stageHistoricalTask = stageHistoricalRepository.runForever();
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
  liveRefresh?.stop();
  secondaryRefresh.stop();
  competitionAutoBackfill.stop();
  apiFootballOddsCollector.stop();
  publicCsvImporter.stop();
  openFootballImporter.stop();
  stageHistoricalRepository.stop();
  await liveTask;
  await secondaryTask;
  await competitionBackfillTask;
  await apiFootballOddsTask;
  await publicCsvImportTask;
  await openFootballImportTask;
  await stageHistoricalTask;
  await pool.end();
}
