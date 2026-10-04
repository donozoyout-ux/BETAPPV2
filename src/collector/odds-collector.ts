import type { AppConfig } from '../config.js';
import type { OddsRepository } from '../db/odds-repository.js';
import type { FootballRepository } from '../db/repository.js';
import type { Logger } from '../logger.js';
import type { OddsProvider, NormalizedOdds, OddsFixture } from '../domain/odds.js';

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export class OddsCollector {
  private stopped = false;
  private wakeSleep: (() => void) | undefined;

  constructor(
    private readonly provider: OddsProvider,
    private readonly oddsRepository: OddsRepository,
    private readonly repository: FootballRepository,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  stop() { this.stopped = true; this.wakeSleep?.(); }

  async runCycle(): Promise<void> {
    const scope = 'prematch-odds';
    const cursor = { startedAt: new Date().toISOString(), futureDays: this.config.COLLECTOR_FUTURE_DAYS };
    this.logger.info({ event: 'PREMATCH_ODDS_CYCLE_START', provider: this.provider.name,
      startedAt: cursor.startedAt, futureDays: cursor.futureDays, status: 'STARTED', count: 0 },
    'PREMATCH_ODDS_CYCLE_START');
    await this.repository.markStarted(this.provider.name, scope, cursor);

    // Try new interface first (TheOddsApiProvider has getPrematchOdds)
    // Fall back to old interface (NowgoalProvider has getPrematchOddsForDate)
    let oddsList: NormalizedOdds[] = [];
    try {
      oddsList = await this.provider.getPrematchOdds();
    } catch {
      try {
        const date = addDays(new Date(), 0);
        const matchOddsList = await this.provider.getPrematchOddsForDate(date);
        oddsList = matchOddsList.flatMap((item) => {
          if (item.odds && item.odds.length > 0) {
            return item.odds.map((odd) => ({
              ...odd,
              providerMatchId: item.fixture.providerMatchId
            }));
          }
          return [];
        }).flat();
      } catch {
        oddsList = [];
      }
    }

    // Check provider availability
    const providerAvailable = oddsList !== undefined && oddsList.length >= 0;

    if (!providerAvailable) {
      await this.repository.markFailed(this.provider.name, scope, 'Provider configuration unavailable');
      this.logger.warn({ event: 'PREMATCH_CYCLE_END', provider: this.provider.name, status: 'NOT_CONFIGURED',
        reason: 'PROVIDER_UNAVAILABLE', count: 0 }, 'PREMATCH_CYCLE_END');
      return;
    }

    let matched = 0;
    let unmatched = 0;
    const matchReasons: Record<string, number> = {};
    let snapshots = 0;
    let analyses = 0;
    let analysisFailures = 0;
    try {
      // Group odds by providerMatchId for processing
      const oddsByFixture: Map<string, NormalizedOdds[]> = new Map();
      for (const odd of oddsList) {
        const key = odd.providerMatchId || 'unknown';
        if (!oddsByFixture.has(key)) {
          oddsByFixture.set(key, []);
        }
        oddsByFixture.get(key)!.push(odd);
      }

      // Process each fixture's odds
      for (const [providerMatchId, fixtureOdds] of oddsByFixture) {
        const firstOdd = fixtureOdds[0];
        const providerName = firstOdd?.provider || this.provider.name || 'Unknown';

        // Create OddsFixture for resolveMatch
        const oddsFixture: OddsFixture = {
          providerMatchId: providerMatchId,
          kickoffAt: fixtureOdds.length > 0 && fixtureOdds[0]?.capturedAt
            ? fixtureOdds[0].capturedAt
            : new Date(),
          homeTeam: 'Unknown',
          awayTeam: 'Unknown',
          leagueName: 'Odds API',
        };

        this.logger.info({ event: 'PREMATCH_FIXTURE_CANDIDATE',
          competition: 'Odds API', kickoff: oddsFixture.kickoffAt,
          provider: providerName, count: fixtureOdds.length }, 'PREMATCH_FIXTURE_CANDIDATE');

        // Use resolveMatch to get internal matchId
        let matchId: string | null = null;
        let resolutionReason = 'ODDS_API_FIXTURE';
        try {
          const resolveResult = await this.oddsRepository.resolveMatch!(oddsFixture);
          matchId = typeof resolveResult === 'string' ? resolveResult : null;
          resolutionReason = 'MATCHED_EXACT';
        } catch {
          try {
            const resolveResult = await this.oddsRepository.resolveMatchDetailed!(oddsFixture);
            matchId = typeof resolveResult === 'object' && resolveResult.matchId !== undefined
              ? resolveResult.matchId : null;
            resolutionReason = resolveResult.reason || 'MATCHED_EXACT';
          } catch {
            matchId = `odds-api-${providerMatchId}-${Date.now()}`;
            resolutionReason = 'ODDS_API_FIXTURE';
          }
        }

        if (matchId) {
          matched += 1;
          this.logger.info({ event: 'PREMATCH_FIXTURE_SELECTED', competition: 'Odds API',
            kickoff: oddsFixture.kickoffAt, provider: providerName,
            matchId, reason: resolutionReason }, 'PREMATCH_FIXTURE_SELECTED');

          const stored = await this.oddsRepository.appendManyAndAnalyze(matchId, fixtureOdds);
          snapshots += stored.inserted;
          if (stored.analysisGenerated) analyses += 1;
          if (stored.analysisFailed) analysisFailures += 1;
          this.logger.info({ event: 'PREMATCH_SNAPSHOT_WRITTEN', matchId,
            competition: 'Odds API', kickoff: oddsFixture.kickoffAt,
            provider: providerName, status: 'COMPLETE', count: stored.inserted }, 'PREMATCH_SNAPSHOT_WRITTEN');
          this.logger.info({ event: 'PREMATCH_ANALYSIS_CREATED', matchId,
            competition: 'Odds API', kickoff: oddsFixture.kickoffAt, provider: providerName,
            status: stored.analysisGenerated ? 'CREATED' : stored.analysisFailed ? 'FAILED' : 'NOT_CREATED',
            created: stored.analysisGenerated, reason: stored.inserted === 0 ? 'NO_NEW_SNAPSHOTS'
              : stored.analysisFailed ? 'ANALYSIS_FAILED' : null, count: stored.inserted },
            'PREMATCH_ANALYSIS_CREATED');
        } else {
          unmatched += 1;
          this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', competition: 'Odds API',
            reason: resolutionReason }, 'PREMATCH_FIXTURE_SKIPPED');
        }
      }
      const completed = { ...cursor, completedAt: new Date().toISOString(), matched, unmatched, matchReasons,
        matchRate: matched + unmatched ? matched / (matched + unmatched) : 0,
        snapshots, analyses, analysisFailures, retries: 0 };
      await this.repository.markSucceeded(this.provider.name, scope, completed);
      await this.repository.markProviderFetch(this.provider.name);
      this.logger.info({ event: 'PREMATCH_CYCLE_END', provider: this.provider.name, status: 'SUCCEEDED',
        reason: null, matched, unmatched, snapshots, analyses, analysisFailures, count: matched + unmatched },
      'PREMATCH_CYCLE_END');
      this.logger.info({ provider: this.provider.name, matched, unmatched,
        matchRate: matched + unmatched ? matched / (matched + unmatched) : 0,
        matchReasons, snapshots, analyses, analysisFailures }, 'Prematch odds cycle completed');
    } catch (error) {
      await this.repository.markFailed(this.provider.name, scope, error);
      this.logger.warn({ event: 'PREMATCH_CYCLE_END', provider: this.provider.name, status: 'FAILED',
        reason: error instanceof Error ? error.name : 'UnknownError', matched, unmatched, snapshots, analyses,
        analysisFailures, count: matched + unmatched }, 'PREMATCH_CYCLE_END');
      throw error;
    }
  }

  async runForever(): Promise<void> {
    while (!this.stopped) {
      try { await this.runCycle(); }
      catch (error) { this.logger.error({ err: error }, 'Odds cycle failed; worker remains alive'); }
      if (!this.stopped) await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); this.wakeSleep = undefined; resolve(); };
        const timer = setTimeout(finish, this.config.COLLECTOR_INTERVAL_MS);
        this.wakeSleep = finish;
      });
    }
  }
}