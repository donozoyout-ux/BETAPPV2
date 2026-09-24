import type { FotMobProvider } from '../providers/fotmob.js';
import type { FootballRepository, MatchWriteOutcome } from '../db/repository.js';
import type { HistoricalRepository } from '../db/historical-repository.js';
import type { CornerRepository } from '../db/corner-repository.js';
import { blankReport, discoverScope, type ExpansionCompetition } from './competition-scope.js';
import type { NormalizedMatch } from '../domain/types.js';

type Dependencies = {
  provider: Pick<FotMobProvider, 'getAvailableSeasons' | 'getSeasonFixtures' | 'getMatchStatistics'>;
  football: Pick<FootballRepository, 'upsertMatch' | 'upsertStatistics'>;
  historical: Pick<HistoricalRepository, 'expansionReport' | 'saveExpansionReport' | 'startJob' | 'updateJob' | 'save' | 'detailsImported' | 'competitionEvidence'>;
  corners: Pick<CornerRepository, 'saveHistorical' | 'recordBackfillFailure' | 'resolveBackfillFailure'>;
  refreshPipeline: () => Promise<void>;
  pause: () => Promise<void>;
};
type Job = { id: string; season: string; fixtures: NormalizedMatch[]; persisted: Set<string>; detailed: Set<string> };
export async function runCompetitionBackfill(c: ExpansionCompetition, options: { seasons: number; resume: boolean; dryRun: boolean }, deps: Dependencies) {
  let report = blankReport(c, options.dryRun);
  const jobs: Job[] = [];
  const persist = async () => { if (!options.dryRun) await deps.historical.saveExpansionReport(report); };
  const fail = (season: string | null, matchId: string | null, phase: string, error: unknown) => {
    report.failures = report.failures.filter(f => !(f.season === season && f.matchId === matchId && f.phase === phase));
    report.failures.push({ season, matchId, phase, reason: (error instanceof Error ? error.message : String(error)).slice(0,2000) });
  };
  const checkpoint = async (job: Job, status: 'RUNNING' | 'COMPLETED' | 'FAILED' = 'RUNNING') => {
    await deps.historical.updateJob(job.id, { requested: job.fixtures.length, received: job.persisted.size,
      inserted: report.matchesInserted, updated: report.matchesUpdated, duplicates: report.duplicateMatchesPrevented,
      errors: report.failures.filter(f => f.season === job.season).length,
      cursor: { version: 'COMPETITION_BACKFILL_V1', persistedIds: [...job.persisted], detailIds: [...job.detailed] } }, status,
    report.failures.find(f => f.season === job.season)?.reason ?? null);
    await persist();
  };
  try {
    const previous = !options.dryRun && options.resume ? await deps.historical.expansionReport(c.id) : null;
    const continuation = previous && (previous.phase !== 'COMPLETE' || previous.failures.length > 0);
    const pinned = continuation ? previous.selectedSeasons : undefined;
    if (continuation) report = { ...previous, completedAt: null, failures: [...previous.failures] };
    await persist();
    const scope = await discoverScope(deps.provider, c, options.seasons, deps.pause, pinned);
    report.availableSeasons = scope.availableSeasons; report.selectedSeasons = [...scope.selected.keys()];
    report.fixturesFetched = [...scope.selected.values()].reduce((sum, fixtures) => sum + fixtures.length, 0);
    report.finishedMatches = [...scope.selected.values()].flat().filter(m => m.status === 'finished').length;
    if (!scope.selected.size) throw new Error('No eligible provider-exposed season found');
    if (scope.selected.size < options.seasons) report.notes.push('Previous completed season was not found within the bounded provider discovery scope.');
    if (options.dryRun) {
      report.notes.push('Discovery only: no database writes, match detail requests or historical examples generated.');
      report.status = 'PASS'; report.phase = 'COMPLETE'; report.completedAt = new Date().toISOString(); return report;
    }
    report.phase = 'FIXTURES'; await persist();
    // Phase A completes across all selected seasons before the first match-detail request.
    for (const [season, allFixtures] of scope.selected) {
      const fixtures = [...new Map(allFixtures.filter(m => m.status === 'finished').map(m => [m.providerExternalId, m])).values()];
      const saved = await deps.historical.startJob('fotmob', String(c.id), season, fixtures.length);
      const cursor = saved.cursor.version === 'COMPETITION_BACKFILL_V1' ? saved.cursor : {};
      const job: Job = { id: saved.id, season, fixtures,
        persisted: new Set(options.resume && previous?.status !== 'PASS' && Array.isArray(cursor.persistedIds) ? cursor.persistedIds as string[] : []),
        detailed: new Set(Array.isArray(cursor.detailIds) ? cursor.detailIds as string[] : []) };
      jobs.push(job);
      for (const match of fixtures) {
        if (job.persisted.has(match.providerExternalId)) continue;
        await deps.pause();
        try {
          const outcome: MatchWriteOutcome = { matchesInserted: 0, matchesUpdated: 0, teamsCreated: 0, duplicateMatchesPrevented: 0 };
          await deps.football.upsertMatch('fotmob', match, outcome);
          for (const key of Object.keys(outcome) as Array<keyof MatchWriteOutcome>) report[key] += outcome[key];
          report.fixturesPersisted++; job.persisted.add(match.providerExternalId);
          report.failures = report.failures.filter(f => !(f.matchId === match.providerExternalId && f.phase === 'FIXTURES'));
        } catch (error) { fail(season, match.providerExternalId, 'FIXTURES', error); }
        await checkpoint(job);
      }
    }
    report.phase = 'DETAILS'; await persist();
    for (const job of jobs) {
      for (const match of job.fixtures) {
        if (!job.persisted.has(match.providerExternalId)) continue;
        const failedBefore = report.failures.some(f => f.matchId === match.providerExternalId && f.phase === 'DETAILS');
        if (job.detailed.has(match.providerExternalId) || (!failedBefore && await deps.historical.detailsImported(match.providerExternalId))) {
          report.detailsSkipped++; job.detailed.add(match.providerExternalId); continue;
        }
        await deps.pause(); report.statisticsRequested++;
        try {
          const stats = await deps.provider.getMatchStatistics(match.providerExternalId);
          await deps.football.upsertStatistics('fotmob', stats);
          // Shared table: corner metadata first, then historical quality/provenance. No synthetic empty response on failure.
          await deps.corners.saveHistorical('fotmob', match, stats, true);
          await deps.historical.save('fotmob', match, stats, new Date(), null, true);
          await deps.corners.resolveBackfillFailure(String(c.id), job.season, match.providerExternalId);
          if (stats.statistics.some(s => s.homeValue != null || s.awayValue != null)) report.statisticsSucceeded++;
          else report.statisticsUnavailable++;
          job.detailed.add(match.providerExternalId);
          report.failures = report.failures.filter(f => !(f.matchId === match.providerExternalId && f.phase === 'DETAILS'));
        } catch (error) {
          fail(job.season, match.providerExternalId, 'DETAILS', error);
          await deps.corners.recordBackfillFailure(String(c.id), job.season, match.providerExternalId, 'RETRYABLE', error);
        }
        report.statisticsFailed = report.failures.filter(f => f.phase === 'DETAILS').length;
        await checkpoint(job);
      }
      await checkpoint(job, report.failures.some(f => f.season === job.season && f.phase === 'FIXTURES') ? 'FAILED' : 'COMPLETED');
    }
    report.phase = 'PIPELINE'; await persist();
    const before = await deps.historical.competitionEvidence(c.name);
    await deps.refreshPipeline();
    const after = await deps.historical.competitionEvidence(c.name);
    report.historicalExamplesGenerated += Math.max(0, after.examples - before.examples);
    report.oddsCoveredMatches = after.odds; report.cornerStatsCoveredMatches = after.corners;
    report.failures = report.failures.filter(f => !['DISCOVERY','PIPELINE'].includes(f.phase));
    report.status = report.failures.length && report.fixturesPersisted === 0 ? 'FAILED'
      : report.failures.length || report.statisticsUnavailable ? 'PARTIAL' : 'PASS';
    report.phase = 'COMPLETE';
  } catch (error) {
    fail(null, null, report.phase, error);
    report.status = report.fixturesPersisted > 0 ? 'PARTIAL' : 'FAILED';
    for (const job of jobs) await checkpoint(job, 'FAILED');
  }
  report.completedAt = new Date().toISOString();
  await persist();
  return report;
}
