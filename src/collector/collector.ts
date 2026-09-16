import type { AppConfig } from '../config.js';
import type { MatchStatistics, NormalizedMatch } from '../domain/types.js';
import type { FootballRepository } from '../db/repository.js';
import type { Logger } from '../logger.js';
import type { FootballDataProvider } from '../providers/provider.js';
import { CircuitBreaker } from '../providers/circuit-breaker.js';

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

type Cursor = { nextDate: string; endDate: string; completed?: boolean };
type CollectorHooks = {
  onStatistics?: (match: NormalizedMatch, statistics: MatchStatistics) => Promise<void>;
  onCycleComplete?: () => Promise<void>;
};

function isCursor(value: Record<string, unknown> | null): value is Cursor {
  return Boolean(value && typeof value.nextDate === 'string' && typeof value.endDate === 'string');
}

export class Collector {
  private stopped = false;
  private wakeSleep: (() => void) | undefined;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly provider: FootballDataProvider,
    private readonly repository: FootballRepository,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly hooks: CollectorHooks = {},
  ) {
    this.circuitBreaker = new CircuitBreaker(
      config.PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
      config.PROVIDER_CIRCUIT_COOLDOWN_MS,
    );
  }

  stop() {
    this.stopped = true;
    this.wakeSleep?.();
  }

  async runCycle(): Promise<void> {
    const scope = 'fixtures-and-statistics';
    if (!this.circuitBreaker.canRequest()) {
      const cooldownUntil = new Date(Date.now() + this.config.PROVIDER_CIRCUIT_COOLDOWN_MS);
      await this.repository.updateCircuitState(this.provider.name, 'OPEN', cooldownUntil);
      this.logger.warn({ provider: this.provider.name, cooldownUntil }, 'Provider circuit open; cycle skipped');
      return;
    }
    await this.repository.updateCircuitState(this.provider.name, this.circuitBreaker.state(), null);
    const health = await this.provider.healthCheck();
    await this.repository.updateProviderStatus(health.provider, health.ok, health.latencyMs, health.message);
    if (!health.ok) {
      this.circuitBreaker.failure();
      await this.repository.updateCircuitState(this.provider.name, this.circuitBreaker.state(),
        this.circuitBreaker.state() === 'OPEN' ? new Date(Date.now() + this.config.PROVIDER_CIRCUIT_COOLDOWN_MS) : null);
      this.logger.warn({ provider: health.provider, message: health.message }, 'Provider unavailable; cycle skipped');
      return;
    }
    this.circuitBreaker.success();

    const stored = await this.repository.getCheckpoint(this.provider.name, scope);
    const now = new Date();
    let cursor: Cursor = isCursor(stored) && !stored.completed
      ? stored
      : {
          nextDate: dateOnly(addDays(now, -this.config.COLLECTOR_HISTORY_DAYS)),
          endDate: dateOnly(addDays(now, this.config.COLLECTOR_FUTURE_DAYS)),
          completed: false,
        };
    await this.repository.markStarted(this.provider.name, scope, cursor);

    try {
      while (!this.stopped && cursor.nextDate <= cursor.endDate) {
        const date = parseDate(cursor.nextDate);
        const matches = await this.provider.getFixtures({ date });
        this.logger.info({ provider: this.provider.name, date: cursor.nextDate, matches: matches.length }, 'Fixtures fetched');
        for (const match of matches) {
          await this.repository.upsertMatch(this.provider.name, match);
          if (match.status !== 'scheduled' && match.status !== 'postponed' && match.status !== 'cancelled') {
            try {
              const statistics = await this.provider.getMatchStatistics(match.providerExternalId);
              await this.repository.upsertStatistics(this.provider.name, statistics);
              await this.hooks.onStatistics?.(match, statistics);
            } catch (error) {
              this.logger.warn({ err: error, matchExternalId: match.providerExternalId }, 'Match statistics unavailable');
            }
          }
        }
        cursor = { ...cursor, nextDate: dateOnly(addDays(date, 1)) };
        await this.repository.markSucceeded(this.provider.name, scope, cursor);
        await this.repository.markProviderFetch(this.provider.name);
      }
      if (!this.stopped) {
        cursor = { ...cursor, completed: true };
        await this.repository.markSucceeded(this.provider.name, scope, cursor);
        await this.hooks.onCycleComplete?.();
      }
    } catch (error) {
      this.circuitBreaker.failure();
      await this.repository.markFailed(this.provider.name, scope, error);
      await this.repository.updateProviderStatus(
        this.provider.name,
        false,
        0,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async runForever(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.runCycle();
      } catch (error) {
        this.logger.error({ err: error }, 'Collector cycle failed; worker remains alive');
      }
      if (!this.stopped) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            this.wakeSleep = undefined;
            resolve();
          };
          const timer = setTimeout(finish, this.config.COLLECTOR_INTERVAL_MS);
          this.wakeSleep = finish;
        });
      }
    }
  }
}
