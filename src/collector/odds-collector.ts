import type { AppConfig } from '../config.js';
import type { OddsRepository } from '../db/odds-repository.js';
import type { FootballRepository } from '../db/repository.js';
import type { Logger } from '../logger.js';
import type { NowgoalProvider } from '../providers/nowgoal.js';

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export class OddsCollector {
  private stopped = false;
  private wakeSleep: (() => void) | undefined;

  constructor(
    private readonly provider: NowgoalProvider,
    private readonly oddsRepository: OddsRepository,
    private readonly repository: FootballRepository,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  stop() { this.stopped = true; this.wakeSleep?.(); }

  async runCycle(): Promise<void> {
    const scope = 'prematch-odds';
    const cursor = { startedAt: new Date().toISOString(), futureDays: this.config.NOWGOAL_FUTURE_DAYS };
    await this.repository.markStarted(this.provider.name, scope, cursor);
    const health = await this.provider.healthCheck();
    await this.repository.updateProviderStatus(health.provider, health.ok, health.latencyMs, health.message);
    if (!health.ok) {
      await this.repository.markFailed(this.provider.name, scope, health.message ?? 'Nowgoal unavailable');
      return;
    }
    let matched = 0;
    let unmatched = 0;
    const matchReasons: Record<string, number> = {};
    let snapshots = 0;
    let analyses = 0;
    let analysisFailures = 0;
    try {
      for (let day = 0; day <= this.config.NOWGOAL_FUTURE_DAYS && !this.stopped; day += 1) {
        const date = addDays(new Date(), day);
        const matches = await this.provider.getPrematchOddsForDate(date);
        for (const item of matches) {
          const resolution = await this.oddsRepository.resolveMatchDetailed(item.fixture);
          matchReasons[resolution.reason] = (matchReasons[resolution.reason] ?? 0) + 1;
          if (!resolution.matchId) { unmatched += 1; continue; }
          matched += 1;
          const stored = await this.oddsRepository.appendManyAndAnalyze(resolution.matchId, item.odds);
          snapshots += stored.inserted;
          if (stored.analysisGenerated) analyses += 1;
          if (stored.analysisFailed) analysisFailures += 1;
        }
      }
      const completed = { ...cursor, completedAt: new Date().toISOString(), matched, unmatched, matchReasons,
        matchRate: matched + unmatched ? matched / (matched + unmatched) : 0,
        snapshots, analyses, analysisFailures, retries: this.provider.consumeRetryCount() };
      await this.repository.markSucceeded(this.provider.name, scope, completed);
      await this.repository.markProviderFetch(this.provider.name);
      this.logger.info({ provider: this.provider.name, matched, unmatched,
        matchRate: matched + unmatched ? matched / (matched + unmatched) : 0,
        matchReasons, snapshots, analyses, analysisFailures }, 'Prematch odds cycle completed');
    } catch (error) {
      await this.repository.markFailed(this.provider.name, scope, error);
      await this.repository.updateProviderStatus(this.provider.name, false, 0,
        error instanceof Error ? error.message : String(error));
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
