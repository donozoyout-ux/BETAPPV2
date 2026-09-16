import { loadConfig } from '../config.js';
import { auditDataset } from '../data/audit.js';
import { CornerRepository, type BackfillProgress } from '../db/corner-repository.js';
import { createPool } from '../db/pool.js';
import { FootballRepository } from '../db/repository.js';
import { createLogger } from '../logger.js';
import { FotMobProvider, fotmobCompetitions } from '../providers/fotmob.js';
import { ProviderHttpError } from '../providers/http-client.js';
import { buildAllLeagueBaselines, buildAllTeamProfiles } from './profiles.js';

const args = new Map(process.argv.slice(2).filter((item) => item.startsWith('--')).map((item) => {
  const [key, ...value] = item.slice(2).split('='); return [key!, value.length ? value.join('=') : 'true'];
}));
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const requestedCompetition = args.get('competition');
const requestedSeason = args.get('season')?.replace('-', '/');
const from = args.get('from') ? new Date(`${args.get('from')}T00:00:00.000Z`) : null;
const to = args.get('to') ? new Date(`${args.get('to')}T23:59:59.999Z`) : null;
const resume = args.get('resume') !== 'false';
const dryRun = args.get('dry-run') === 'true';
const config = loadConfig();

const enabledCompetitions = fotmobCompetitions.filter((item) => config.SUPPORTED_COMPETITIONS.includes(item.key));
const selected = requestedCompetition
  ? enabledCompetitions.filter((item) => [item.key,item.name,String(item.id)].some((value) => normalize(value) === normalize(requestedCompetition)))
  : enabledCompetitions;
if (!selected.length) throw new Error(`Unknown competition: ${requestedCompetition}`);

if (!config.BACKFILL_ENABLED) throw new Error('Historical backfill is disabled. Set BACKFILL_ENABLED=true for this job.');
if (!config.FOTMOB_ENABLED) throw new Error('FotMob is disabled. Set FOTMOB_ENABLED=true for historical backfill.');
const logger = createLogger(config, 'betapp-backfill').child({ job: 'historical-backfill', provider: 'fotmob' });
const pool = createPool(config);
const football = new FootballRepository(pool);
const corners = new CornerRepository(pool);
const provider = new FotMobProvider(config, logger);

function hasCompleteCorners(statistics: Awaited<ReturnType<FotMobProvider['getMatchStatistics']>>) {
  const item = statistics.statistics.find((stat) => ['corners','corner_kicks'].includes(stat.key) && stat.period === 'ALL');
  return item?.homeValue != null && item.awayValue != null;
}

function failureClassification(error: unknown): 'RETRYABLE' | 'PERMANENT' {
  if (error instanceof ProviderHttpError) return error.retryable ? 'RETRYABLE' : 'PERMANENT';
  if (error instanceof Error && (error.name === 'AbortError' || /timeout|ECONN|fetch failed/i.test(error.message))) return 'RETRYABLE';
  return 'PERMANENT';
}

try {
  for (const competition of selected) {
    const available = await provider.getAvailableSeasons(competition.id);
    const seasons = requestedSeason ? available.filter((season) => season.replace('-', '/') === requestedSeason) : available.slice(0, 2).reverse();
    if (requestedSeason && !seasons.length) throw new Error(`${competition.name} does not expose season ${requestedSeason}`);
    for (const season of seasons) {
      const scope = `corner-backfill:${competition.id}:${season}`;
      const discovered = (await provider.getHistoricalFixtures(competition.id, season))
        .filter((match) => (!from || match.kickoffAt >= from) && (!to || match.kickoffAt <= to));
      const checkpoint = resume ? await football.getCheckpoint('fotmob', scope) : null;
      let index = checkpoint && typeof checkpoint.index === 'number' ? checkpoint.index : 0;
      const run = await corners.startBackfillRun(String(competition.id), competition.name, season, discovered.length, dryRun);
      const progress: BackfillProgress = resume && !dryRun ? run.progress : { fixturesDiscovered: discovered.length, matchesFetched: 0,
        matchesStored: 0, cornerComplete: 0, partial: 0, failed: 0, retries: 0, lastCheckpoint: 0 };
      progress.retries += provider.consumeRetryCount();
      const runId = run.id;
      if (dryRun) {
        await corners.updateBackfillRun(runId, progress, 'DRY_RUN');
        console.log(JSON.stringify({ competition: competition.name, season, dryRun: true, ...progress }));
        continue;
      }
      await football.markStarted('fotmob', scope, { index, total: discovered.length, competition: competition.name, season });
      for (; index < discovered.length; index += 1) {
        const match = discovered[index]!;
        const matchStartedAt = Date.now();
        let matchStatus = 'STORED';
        try {
          await football.upsertMatch('fotmob', match);
          progress.matchesFetched += 1;
          let statistics;
          try {
            statistics = await provider.getMatchStatistics(match.providerExternalId);
          } catch (error) {
            matchStatus = 'PARTIAL';
            progress.failed += 1;
            await corners.recordBackfillFailure(String(competition.id), season, match.providerExternalId,
              failureClassification(error), error);
            logger.warn({ err: error, match: match.providerExternalId }, 'Backfill statistics missing; retaining partial match');
            statistics = { matchProviderExternalId: match.providerExternalId, statistics: [], sourceUpdatedAt: new Date(), raw: { unavailable: true } };
          }
          progress.retries += provider.consumeRetryCount();
          await football.upsertStatistics('fotmob', statistics);
          await corners.saveHistorical('fotmob', match, statistics);
          if (statistics.statistics.length) await corners.resolveBackfillFailure(String(competition.id), season, match.providerExternalId);
          progress.matchesStored += 1;
          if (hasCompleteCorners(statistics)) progress.cornerComplete += 1; else progress.partial += 1;
        } catch (error) {
          matchStatus = 'FAILED';
          progress.failed += 1;
          await corners.recordBackfillFailure(String(competition.id), season, match.providerExternalId,
            failureClassification(error), error);
          logger.error({ err: error, match: match.providerExternalId }, 'Backfill match failed');
        }
        progress.lastCheckpoint = index + 1;
        await football.markSucceeded('fotmob', scope, { index: index + 1, total: discovered.length, competition: competition.name, season });
        await corners.updateBackfillRun(runId, progress);
        logger.info({ competition: competition.name, season, matchId: match.providerExternalId,
          durationMs: Date.now() - matchStartedAt, status: matchStatus }, 'Historical match processed');
        if ((index + 1) % 10 === 0 || index + 1 === discovered.length) console.log(JSON.stringify({ competition: competition.name, season, ...progress }));
      }
      await corners.updateBackfillRun(runId, progress, 'COMPLETED');
    }
  }
  if (!dryRun) {
    const history = await corners.loadHistory();
    await corners.saveProfiles(buildAllTeamProfiles(history));
    await corners.saveBaselines(buildAllLeagueBaselines(history));
    const audit = auditDataset(history, await corners.auditIntegrity());
    await corners.saveDatasetAudit(audit);
    console.log(JSON.stringify({ datasetAudit: audit }));
  }
} finally {
  await pool.end();
}
