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
    if (!this.enabled()) return { state: 'DISABLED' as const };
    const scope = 'prematch-odds-api-football';
    const startedAt = new Date();
    const cursor = {
      startedAt: startedAt.toISOString(),
      futureDays: this.config.API_FOOTBALL_PREMATCH_FUTURE_DAYS,
      maxFixtures: this.config.API_FOOTBALL_PREMATCH_MAX_FIXTURES,
    };
    await this.repository.markStarted('api-football', scope, cursor);

    try {
      const resolved: Omit<Candidate, 'lastAttemptAt'>[] = [];
      const matchReasons: Record<string, number> = {};
      let discovered = 0;
      let unresolved = 0;

      for (let day = 0; day <= this.config.API_FOOTBALL_PREMATCH_FUTURE_DAYS && !this.stopped; day += 1) {
        const fixtures = await this.provider.fixturesForDate(addDays(startedAt, day));
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
          if (!resolution.matchId) { unresolved += 1; continue; }
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
      }).slice(0, this.config.API_FOOTBALL_PREMATCH_MAX_FIXTURES);

      let attempted = 0;
      let withOdds = 0;
      let snapshots = 0;
      let analyses = 0;
      let analysisFailures = 0;
      let errors = 0;

      for (const candidate of candidates) {
        if (this.stopped) break;
        attempted += 1;
        try {
          const result = await this.provider.prematchOdds(candidate.fixture);
          if (!result.odds.length) {
            await this.oddsRepository.markCollectionState({
              provider: 'api-football', matchId: candidate.matchId,
              providerMatchId: candidate.fixture.snapshot.externalId,
              status: 'NO_ODDS', inserted: 0,
            });
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
        } catch (error) {
          errors += 1;
          await this.oddsRepository.markCollectionState({
            provider: 'api-football', matchId: candidate.matchId,
            providerMatchId: candidate.fixture.snapshot.externalId,
            status: 'ERROR', inserted: 0, error,
          }).catch(() => undefined);
          this.logger.warn({ err: error, matchId: candidate.matchId }, 'API-Football prematch odds fixture failed');
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
      return { state: 'SUCCESS' as const, ...completed };
    } catch (error) {
      await this.repository.markFailed('api-football', scope, error);
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
