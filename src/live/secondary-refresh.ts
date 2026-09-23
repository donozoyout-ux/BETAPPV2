import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { isCompetitionConfigured } from '../matching/competition.js';
import { ApiFootballProvider, apiEvents, apiLiveOdds, apiStatistics } from '../providers/api-football.js';
import type { LiveRepository } from './repository.js';
import type { SourceData } from './types.js';
export class SecondaryLiveRefresh {
  private running = false;
  private stopped = false;
  private nextCycle = 0;
  private wake: (() => void) | undefined;
  private readonly details = new Map<string, { signature: string; at: number }>();
  constructor(private readonly provider: ApiFootballProvider, private readonly repository: LiveRepository,
    private readonly config: AppConfig, private readonly logger: Logger) {}
  stop() { this.stopped = true; this.wake?.(); }
  async runCycle() {
    if (this.running || Date.now() < this.nextCycle || this.stopped) return;
    this.running = true; this.nextCycle = Date.now() + 30_000;
    let unresolved = 0;
    try {
      if (!this.provider.configured) { await this.repository.health('NOT_CONFIGURED'); return; }
      const fixtures = await this.provider.fixtures();
      for (const fixture of fixtures) {
        if (this.stopped) break;
        if (!isCompetitionConfigured(fixture.league, this.config.SUPPORTED_COMPETITIONS) || fixture.snapshot.status !== 'live') continue;
        const id = await this.repository.resolve(fixture);
        if (!id) { unresolved++; continue; }
        const existing = await this.repository.read(id);
        const old = existing.find(s => s.snapshot.provider === 'api-football');
        const data: SourceData = { snapshot: fixture.snapshot, events: null, statistics: null, odds: null, detailsAt: null };
        // Persist summary even if a detail endpoint is unavailable.
        await this.repository.save(id, data);
        const signature = JSON.stringify([fixture.snapshot.homeScore, fixture.snapshot.awayScore, fixture.snapshot.phase]);
        const previous = this.details.get(id);
        if (previous && previous.signature === signature && Date.now() - previous.at < 60_000) continue;
        try {
          const eventRows = await this.provider.request(`/fixtures/events?fixture=${encodeURIComponent(fixture.snapshot.externalId)}`);
          data.events = apiEvents(eventRows, fixture, id, new Date().toISOString());
          data.detailsAt = new Date().toISOString();
          await this.repository.save(id, data);
          const stats = await this.provider.request(`/fixtures/statistics?fixture=${encodeURIComponent(fixture.snapshot.externalId)}`);
          data.statistics = apiStatistics(stats, fixture, new Date().toISOString());
          await this.repository.save(id, data);
          const odds = await this.provider.request(`/odds/live?fixture=${encodeURIComponent(fixture.snapshot.externalId)}`);
          data.odds = apiLiveOdds(odds, fixture, new Date().toISOString());
          await this.repository.save(id, data);
          this.details.set(id, { signature, at: Date.now() });
        } catch {
          // Preserve already saved evidence, but do not retain an old odds quote as current.
          await this.repository.save(id, { ...data, statistics: data.statistics ?? old?.statistics ?? null, odds: null });
          break;
        }
      }
    } catch { this.logger.warn('API-Football live refresh unavailable; primary flow continues'); }
    finally {
      try { await this.repository.health(this.provider.health, unresolved ? `MATCH_UNRESOLVED: ${unresolved}` : null); }
      finally { this.running = false; }
    }
  }
  async runForever() {
    while (!this.stopped) {
      try { await this.runCycle(); } catch { this.logger.warn('Secondary live persistence unavailable'); }
      if (!this.stopped) await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.wake = undefined; resolve(); }, 30_000);
        this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      });
    }
  }
}
