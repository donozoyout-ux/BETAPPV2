import type { AppConfig } from '../config.js';
import type { OddsRepository } from '../db/odds-repository.js';
import type { FootballRepository } from '../db/repository.js';
import type { Logger } from '../logger.js';
import type { ApiFixture, ApiFootballProvider } from '../providers/api-football.js';

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

type Candidate = { fixture: ApiFixture; matchId: string; reason: string; lastAttemptAt: Date | null };

export class ApiFootballPrematchOddsCollector {
  private stopped = false;
  private wakeSleep: (() => void) | undefined;

  constructor(
    private readonly provider: ApiFootballProvider,
    private readonly oddsRepository: OddsRepository,
    private readonly repository: FootballRepository,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  enabled() {
    return this.provider.configured && this.config.API_FOOTBALL_PREMATCH_ODDS_ENABLED;
  }

  stop() {
    this.stopped = true;
    this.wakeSleep?.();
  }

  private async wait() {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.wakeSleep = undefined;
        resolve();
      };
      const timer = setTimeout(finish, this.config.API_FOOTBALL_PREMATCH_INTERVAL_MS);
      this.wakeSleep = finish;
    });
  }

  async runCycle() {
    if (!this.enabled()) {
      this.logger.info({ event: 'PREMATCH_CYCLE_END', provider: 'api-football', status: 'DISABLED',
        reason: 'PROVIDER_DISABLED', count: 0 }, 'PREMATCH_CYCLE_END');
      return { state: 'DISABLED' as const };
    }
    const scope = 'prematch-odds-api-football';
    const startedAt = new Date();
    const cursor = {
      startedAt: startedAt.toISOString(),
      futureDays: this.config.API_FOOTBALL_PREMATCH_FUTURE_DAYS,
      maxFixtures: this.config.API_FOOTBALL_PREMATCH_MAX_FIXTURES,
    };
    this.logger.info({ event: 'PREMATCH_ODDS_CYCLE_START', provider: 'api-football',
      startedAt: cursor.startedAt, futureDays: cursor.futureDays, status: 'STARTED', count: 0 },
    'PREMATCH_ODDS_CYCLE_START');
    await this.repository.markStarted('api-football', scope, cursor);

    try {
      const resolved: Omit<Candidate, 'lastAttemptAt'>[] = [];
      const matchReasons: Record<string, number> = {};
      let discovered = 0;
      let unresolved = 0;

      for (let day = 0; day <= this.config.API_FOOTBALL_PREMATCH_FUTURE_DAYS && !this.stopped; day += 1) {
        const date = addDays(startedAt, day);
        const dateLabel = date.toISOString().slice(0, 10);
        let httpStatus: number | null = null;
        this.logger.info({ event: 'PREMATCH_PROVIDER_REQUEST', provider: 'api-football', requestType: 'fixture_list',
          date: dateLabel }, 'PREMATCH_PROVIDER_REQUEST');
        let fixtures: ApiFixture[];
        try {
          fixtures = await this.provider.fixturesForDate(date, (status) => { httpStatus = status; });
          this.logger.info({ event: 'PREMATCH_PROVIDER_RESPONSE', provider: 'api-football', requestType: 'fixture_list',
            date: dateLabel, httpStatus, requestSuccess: true, count: fixtures.length }, 'PREMATCH_PROVIDER_RESPONSE');
        } catch (error) {
          this.logger.warn({ event: 'PREMATCH_PROVIDER_RESPONSE', provider: 'api-football', requestType: 'fixture_list',
            date: dateLabel, httpStatus, requestSuccess: false, errorClass: error instanceof Error ? error.name : 'UnknownError',
            count: 0 }, 'PREMATCH_PROVIDER_RESPONSE');
          throw error;
        }
        discovered += fixtures.length;
        for (const fixture of fixtures) {
          if (new Date(fixture.kickoffAt) <= startedAt) continue;
          const resolution = await this.oddsRepository.resolveMatchDetailed({
            providerMatchId: fixture.snapshot.externalId,
            kickoffAt: new Date(fixture.kickoffAt),
            homeTeam: fixture.homeTeam,
            awayTeam: fixture.awayTeam,
            leagueName: fixture.league,
          });
          matchReasons[resolution.reason] = (matchReasons[resolution.reason] ?? 0) + 1;
          const traceFields = { competition: fixture.league, kickoff: fixture.kickoffAt,
            provider: 'api-football', status: fixture.snapshot.status, count: 1 };
          this.logger.info({ event: 'PREMATCH_FIXTURE_CANDIDATE', ...traceFields }, 'PREMATCH_FIXTURE_CANDIDATE');
          if (!resolution.matchId) {
            unresolved += 1;
            this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', ...traceFields, reason: resolution.reason },
              'PREMATCH_FIXTURE_SKIPPED');
            continue;
          }
          this.logger.info({ event: 'PREMATCH_FIXTURE_SELECTED', ...traceFields, matchId: resolution.matchId,
            reason: resolution.reason }, 'PREMATCH_FIXTURE_SELECTED');
          resolved.push({ fixture, matchId: resolution.matchId, reason: resolution.reason });
        }
      }

      const states = await this.oddsRepository.collectionStates('api-football', [...new Set(resolved.map((item) => item.matchId))]);
      const candidates: Candidate[] = resolved.map((item) => ({
        ...item,
        lastAttemptAt: states.get(item.matchId)?.lastAttemptAt ?? null,
      })).sort((a, b) => {
        const aTime = a.lastAttemptAt?.getTime() ?? 0;
        const bTime = b.lastAttemptAt?.getTime() ?? 0;
        if (aTime !== bTime) return aTime - bTime;
        return new Date(a.fixture.kickoffAt).getTime() - new Date(b.fixture.kickoffAt).getTime();
      });
      for (const skipped of candidates.slice(this.config.API_FOOTBALL_PREMATCH_MAX_FIXTURES)) {
        this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', matchId: skipped.matchId,
          competition: skipped.fixture.league, kickoff: skipped.fixture.kickoffAt, provider: 'api-football',
          status: skipped.fixture.snapshot.status, reason: 'MAX_FIXTURES_PER_CYCLE', count: 0 },
        'PREMATCH_FIXTURE_SKIPPED');
      }
      candidates.splice(this.config.API_FOOTBALL_PREMATCH_MAX_FIXTURES);

      let attempted = 0;
      let withOdds = 0;
      let snapshots = 0;
      let analyses = 0;
      let analysisFailures = 0;
      let errors = 0;

      for (const candidate of candidates) {
        if (this.stopped) break;
        attempted += 1;
        let httpStatus: number | null = null;
        const traceFields = { matchId: candidate.matchId, competition: candidate.fixture.league,
          kickoff: candidate.fixture.kickoffAt, provider: 'api-football', status: candidate.fixture.snapshot.status };
        try {
          this.logger.info({ event: 'PREMATCH_PROVIDER_REQUEST', ...traceFields, requestType: 'fixture_odds' },
            'PREMATCH_PROVIDER_REQUEST');
          const result = await this.provider.prematchOdds(candidate.fixture, (status) => { httpStatus = status; });
          this.logger.info({ event: 'PREMATCH_PROVIDER_RESPONSE', ...traceFields, requestType: 'fixture_odds',
            httpStatus, requestSuccess: true, count: result.odds.length }, 'PREMATCH_PROVIDER_RESPONSE');
          this.logger.info({ event: 'PREMATCH_ODDS_NORMALIZED', ...traceFields,
            normalizedQuoteCount: result.odds.length, count: result.odds.length }, 'PREMATCH_ODDS_NORMALIZED');
          if (!result.odds.length) {
            await this.oddsRepository.markCollectionState({
              provider: 'api-football', matchId: candidate.matchId,
              providerMatchId: candidate.fixture.snapshot.externalId,
              status: 'NO_ODDS', inserted: 0,
            });
            this.logger.info({ event: 'PREMATCH_SNAPSHOT_WRITTEN', ...traceFields,
              status: 'SKIPPED', reason: 'NO_ODDS', count: 0 }, 'PREMATCH_SNAPSHOT_WRITTEN');
            this.logger.info({ event: 'PREMATCH_ANALYSIS_CREATED', ...traceFields,
              created: false, status: 'NOT_CREATED', reason: 'NO_ODDS', count: 0 }, 'PREMATCH_ANALYSIS_CREATED');
            continue;
          }
          withOdds += 1;
          const stored = await this.oddsRepository.appendManyAndAnalyze(candidate.matchId, result.odds);
          snapshots += stored.inserted;
          if (stored.analysisGenerated) analyses += 1;
          if (stored.analysisFailed) analysisFailures += 1;
          await this.oddsRepository.markCollectionState({
            provider: 'api-football', matchId: candidate.matchId,
            providerMatchId: candidate.fixture.snapshot.externalId,
            status: 'SUCCESS', inserted: stored.inserted,
            capturedAt: result.odds[0]?.capturedAt ?? null,
          });
          this.logger.info({ event: 'PREMATCH_SNAPSHOT_WRITTEN', ...traceFields, count: stored.inserted },
            'PREMATCH_SNAPSHOT_WRITTEN');
          this.logger.info({ event: 'PREMATCH_ANALYSIS_CREATED', ...traceFields,
            created: stored.analysisGenerated, status: stored.analysisGenerated ? 'CREATED'
              : stored.analysisFailed ? 'FAILED' : 'NOT_CREATED', reason: stored.inserted === 0 ? 'NO_NEW_SNAPSHOTS'
                : stored.analysisFailed ? 'ANALYSIS_FAILED' : null, count: stored.inserted }, 'PREMATCH_ANALYSIS_CREATED');
        } catch (error) {
          errors += 1;
          await this.oddsRepository.markCollectionState({
            provider: 'api-football', matchId: candidate.matchId,
            providerMatchId: candidate.fixture.snapshot.externalId,
            status: 'ERROR', inserted: 0, error,
          }).catch(() => undefined);
          this.logger.warn({ err: error, matchId: candidate.matchId }, 'API-Football prematch odds fixture failed');
          this.logger.warn({ event: 'PREMATCH_PROVIDER_RESPONSE', provider: 'api-football', matchId: candidate.matchId,
            competition: candidate.fixture.league, kickoff: candidate.fixture.kickoffAt,
            status: candidate.fixture.snapshot.status, httpStatus, requestSuccess: false, errorClass: error instanceof Error
              ? error.name : 'UnknownError', count: 0 }, 'PREMATCH_PROVIDER_RESPONSE');
        }
      }

      const completed = {
        ...cursor,
        completedAt: new Date().toISOString(),
        discovered,
        resolved: resolved.length,
        unresolved,
        matchReasons,
        attempted,
        withOdds,
        snapshots,
        analyses,
        analysisFailures,
        errors,
        providerHealth: this.provider.health,
      };
      await this.repository.markSucceeded('api-football', scope, completed);
      await this.repository.markProviderFetch('api-football');
      this.logger.info(completed, 'API-Football prematch odds cycle completed');
      this.logger.info({ event: 'PREMATCH_CYCLE_END', provider: 'api-football', status: 'SUCCEEDED', reason: null,
        matched: resolved.length - unresolved, unmatched: unresolved, snapshots, analyses, analysisFailures, errors,
        count: discovered }, 'PREMATCH_CYCLE_END');
      return { state: 'SUCCESS' as const, ...completed };
    } catch (error) {
      await this.repository.markFailed('api-football', scope, error);
      this.logger.warn({ event: 'PREMATCH_CYCLE_END', provider: 'api-football', status: 'FAILED',
        reason: error instanceof Error ? error.name : 'UnknownError', count: 0 }, 'PREMATCH_CYCLE_END');
      this.logger.error({ err: error }, 'API-Football prematch odds cycle failed');
      return { state: 'ERROR' as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async runForever() {
    if (!this.enabled()) return;
    while (!this.stopped) {
      await this.runCycle();
      if (!this.stopped) await this.wait();
    }
  }
}
