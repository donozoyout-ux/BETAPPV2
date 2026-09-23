import type { MatchStatistics, NormalizedMatch } from '../domain/types.js';
import type { FootballDataProvider } from '../providers/provider.js';
import type { FootballRepository } from '../db/repository.js';
import type { Logger } from '../logger.js';
import { CircuitBreaker } from '../providers/circuit-breaker.js';

/** Worker-only refresh. Browser requests read persisted data and never call providers. */
export class LiveRefresh {
  private stopped = false;
  private running = false;
  private readonly observedLive = new Set<string>();
  private wake: (() => void) | undefined;
  private readonly breaker = new CircuitBreaker(3, 300_000);
  constructor(private readonly provider: FootballDataProvider, private readonly repository: FootballRepository,
    private readonly logger: Logger,
    private readonly onDetails?: (match: NormalizedMatch, id: string, stats: MatchStatistics) => Promise<void>) {}
  stop() { this.stopped = true; this.wake?.(); }
  async runCycle(now = new Date()) {
    if (this.running || !this.breaker.canRequest()) return;
    this.running = true;
    try {
      // Include yesterday so a match crossing midnight can reach its final state.
      for (const offset of [-1, 0]) {
        const date = new Date(now.getTime() + offset * 86_400_000);
        const matches = await this.provider.getFixtures({ date });
        for (const match of matches) {
          if (this.stopped) return;
          const id = await this.repository.upsertMatch(this.provider.name, match);
          if (match.status === 'live') this.observedLive.add(match.providerExternalId);
          if (match.status === 'live' || (match.status === 'finished' && this.observedLive.has(match.providerExternalId))) {
            const stats = await this.provider.getMatchStatistics(match.providerExternalId);
            await this.repository.upsertStatistics(this.provider.name, stats);
            await this.onDetails?.(match, id, stats);
            if (match.status === 'finished') this.observedLive.delete(match.providerExternalId);
          }
        }
      }
      this.breaker.success();
    } catch (error) {
      this.breaker.failure();
      this.logger.warn({ err: error }, 'Live refresh unavailable; retaining last persisted state');
    } finally { this.running = false; }
  }
  async runForever() {
    while (!this.stopped) {
      await this.runCycle();
      if (!this.stopped) await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.wake = undefined; resolve(); }, 60_000);
        this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      });
    }
  }
}
