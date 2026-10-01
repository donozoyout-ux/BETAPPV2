import { loadConfig } from '../config.js';
import { HistoricalRepository } from '../db/historical-repository.js';
import { createPool } from '../db/pool.js';
import { FootballRepository } from '../db/repository.js';
import { createLogger } from '../logger.js';
import { canStartHistoricalCollector, historicalProviderPolicies } from './provider-policy.js';
import { FotMobProvider, fotmobCompetitions } from '../providers/fotmob.js';
import { CircuitBreaker } from '../providers/circuit-breaker.js';
import { runFotMobDryRun } from './fotmob-dry-run.js';
import { runOpenFootballDryRun } from './openfootball-dry-run.js';
import { OpenFootballHistoricalImporter } from './openfootball-importer.js';
import { OpenFootballImportRepository } from './openfootball-repository.js';
import type { HistoricalProviderId } from './types.js';

const args = new Map(process.argv.slice(2).filter((item) => item.startsWith('--')).map((item) => {
  const [key, ...rest] = item.slice(2).split('='); return [key!, rest.join('=') || 'true'];
}));
const providerId = (args.get('provider') ?? 'fotmob') as HistoricalProviderId;
const competitionKey = (args.get('competition') ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const seasonArg = args.get('season')?.replace('-', '/');
const dryRun = args.get('dry-run') === 'true';
const resume = args.get('resume') !== 'false';
const fromArg = args.get('from');

const rawDbUrl = process.env.DATABASE_URL;
const env = { ...process.env, DATABASE_URL: rawDbUrl || 'postgres://localhost:5432/readonly_dryrun' };
const config = loadConfig(env);
const policy = historicalProviderPolicies[providerId];
if (!policy) throw new Error(`Unknown historical provider: ${providerId}`);
if (!canStartHistoricalCollector(providerId)) throw new Error(`${providerId}: ${policy.status}; ${policy.reason}`);

const isBackfillAllowed = config.DATA_BACKFILL_ENABLED || config.BACKFILL_ENABLED || config.OPENFOOTBALL_IMPORT_ENABLED;

if (providerId === 'openfootball') {
  if (dryRun) {
    const report = await runOpenFootballDryRun(config, {
      competition: args.get('competition'),
      season: seasonArg,
      fromDate: fromArg ?? '2024-01-01',
    });
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (!rawDbUrl || rawDbUrl.includes('readonly_dryrun')) {
      console.log(JSON.stringify({
        status: 'PRODUCTION_DB_UNAVAILABLE',
        provider: 'openfootball',
        writePerformed: false,
        message: 'DATABASE_URL is not configured in local environment. No write was performed.',
      }, null, 2));
      process.exit(0);
    }
    if (!isBackfillAllowed) {
      console.log(JSON.stringify({
        status: 'BACKFILL_DISABLED',
        provider: 'openfootball',
        writePerformed: false,
        message: 'DATA_BACKFILL_ENABLED=false. Write is blocked by default safety flag.',
      }, null, 2));
      process.exit(0);
    }
    const pool = createPool(config);
    const football = new FootballRepository(pool);
    const historical = new HistoricalRepository(pool);
    const openFootballImports = new OpenFootballImportRepository(pool);
    const logger = createLogger(config, 'betapp-openfootball-backfill');
    const importer = new OpenFootballHistoricalImporter(
      { ...config, OPENFOOTBALL_IMPORT_ENABLED: true },
      football,
      historical,
      openFootballImports,
      logger,
    );
    try {
      const summary: Array<Record<string, unknown>> = [];
      while (true) {
        const result = await importer.runCycle();
        if (result.state === 'DISABLED' || result.state === 'COMPLETE' || result.state === 'IDLE') {
          break;
        }
        summary.push(result);
        if (result.state === 'ERROR' || result.state === 'WAITING_RETRY') break;
      }
      console.log(JSON.stringify({
        status: 'IMPORT_COMPLETED',
        provider: 'openfootball',
        writePerformed: true,
        summary,
      }, null, 2));
    } finally {
      await pool.end();
    }
  }
} else {
  if (providerId !== 'fotmob') throw new Error(`${providerId} does not have an approved collector.`);
  const competition = fotmobCompetitions.find((item) => [item.key, item.name, String(item.id)].some((value) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '') === competitionKey));
  if (!competition) throw new Error('Use --competition with a supported FotMob competition.');

  const logger = createLogger(config, 'betapp-historical-backfill');
  const fotmob = new FotMobProvider(config, logger);
  if (dryRun) {
    if (!seasonArg) throw new Error('A dry run requires --season=YYYY-YYYY so its scope is explicit.');
    console.log(JSON.stringify(await runFotMobDryRun(config, competition, seasonArg, Number(args.get('sample') ?? '12')), null, 2));
  } else {
    if (!rawDbUrl || rawDbUrl.includes('readonly_dryrun')) {
      console.log(JSON.stringify({
        status: 'PRODUCTION_DB_UNAVAILABLE',
        provider: 'fotmob',
        writePerformed: false,
        message: 'DATABASE_URL is not configured in local environment. No write was performed.',
      }, null, 2));
      process.exit(0);
    }
    if (!isBackfillAllowed) {
      console.log(JSON.stringify({
        status: 'BACKFILL_DISABLED',
        provider: 'fotmob',
        writePerformed: false,
        message: 'DATA_BACKFILL_ENABLED=false. Write is blocked by default safety flag.',
      }, null, 2));
      process.exit(0);
    }
    const pool = createPool(config);
    const football = new FootballRepository(pool);
    const historical = new HistoricalRepository(pool);
    const circuit = new CircuitBreaker(config.PROVIDER_CIRCUIT_FAILURE_THRESHOLD, config.PROVIDER_CIRCUIT_COOLDOWN_MS);
    const pause = () => new Promise<void>((resolve) => setTimeout(resolve, config.HISTORICAL_REQUEST_DELAY_MS));
    try {
      const available = await fotmob.getAvailableSeasons(competition.id);
      const seasons = seasonArg ? available.filter((season) => season.replace('-', '/') === seasonArg) : available.slice(0, 2).reverse();
      if (seasonArg && !seasons.length) throw new Error(`${competition.name} does not expose season ${seasonArg}`);
      for (const season of seasons) {
        const fixtures = await fotmob.getHistoricalFixtures(competition.id, season);
        const job = await historical.startJob(providerId, String(competition.id), season, fixtures.length);
        const start = resume && typeof job.cursor.index === 'number' ? Number(job.cursor.index) : 0;
        const progress = { requested: fixtures.length, received: start, inserted: 0, updated: 0, duplicates: 0, errors: 0, cursor: { index: start } };
        for (let index = start; index < fixtures.length; index += 1) {
          const fixture = fixtures[index]!;
          try {
            if (!circuit.canRequest()) throw new Error('FotMob circuit is open; historical backfill paused for cooldown.');
            await football.upsertMatch('fotmob', fixture);
            const statistics = await fotmob.getMatchStatistics(fixture.providerExternalId);
            await football.upsertStatistics('fotmob', statistics);
            const saved = await historical.save('fotmob', fixture, statistics);
            progress[saved.action === 'inserted' ? 'inserted' : saved.action === 'updated' ? 'updated' : 'duplicates'] += 1;
            circuit.success();
          } catch (error) {
            progress.errors += 1;
            circuit.failure();
            logger.warn({ err: error, match: fixture.providerExternalId }, 'Historical fixture failed; continuing');
          }
          progress.received += 1; progress.cursor = { index: index + 1 };
          await historical.updateJob(job.id, progress, 'RUNNING');
          if (index + 1 < fixtures.length) await pause();
        }
        await historical.updateJob(job.id, progress, 'COMPLETED');
        console.log(JSON.stringify({ providerId, competition: competition.name, season, ...progress }));
      }
    } finally {
      await pool.end();
    }
  }
}

