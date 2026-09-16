import type { AppConfig } from '../config.js';
import type { NormalizedOdds, OddsProvider } from '../domain/odds.js';
import { notTestedChecks, type ProviderQualification, type QualifiableProvider } from '../qualification/types.js';

abstract class PublicPageQualificationProvider implements QualifiableProvider {
  abstract readonly name: string;
  protected abstract readonly baseUrl: string;
  protected abstract readonly relevantCapabilities: readonly string[];

  async qualify(): Promise<ProviderQualification> {
    const started = Date.now();
    try {
      const response = await fetch(this.baseUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'text/html', 'user-agent': 'BETAPP-V2/2.0' },
      });
      const body = await response.text();
      const reachable = response.ok && body.length > 1000;
      const checks = notTestedChecks(this.name, this.baseUrl);
      for (const item of checks) {
        item.httpStatus = response.status;
        item.latencyMs = Date.now() - started;
        item.notes = this.relevantCapabilities.includes(item.capability)
          ? 'Public HTML erişilebilir; doğrulanmış JSON şeması olmadığı için capability PASS sayılmadı'
          : 'Bu provider rolü için kullanılmıyor';
      }
      return { provider: this.name, connection: reachable ? 'SUPPORTED' : 'UNAVAILABLE', checks };
    } catch (error) {
      return {
        provider: this.name, connection: 'UNAVAILABLE',
        checks: notTestedChecks(this.name, this.baseUrl).map((item) => ({
          ...item, result: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - started,
        })),
      };
    }
  }
}

export class IddaaProvider extends PublicPageQualificationProvider implements OddsProvider {
  readonly name = 'iddaa';
  protected readonly baseUrl: string;
  protected readonly relevantCapabilities = ['FIXTURES', 'PREMATCH_ODDS', 'LIVE_ODDS', 'ODDS_MARKETS'] as const;
  constructor(config: AppConfig) { super(); this.baseUrl = config.IDDAA_BASE_URL; }
  async getPrematchOdds(): Promise<NormalizedOdds[]> { return []; }
}

export class FlashscoreProvider extends PublicPageQualificationProvider {
  readonly name = 'flashscore';
  protected readonly baseUrl: string;
  protected readonly relevantCapabilities = ['FIXTURES', 'MATCH_RESULT', 'CORNERS', 'YELLOW_CARDS', 'RED_CARDS', 'SHOTS', 'SHOTS_ON_TARGET', 'POSSESSION', 'XG', 'LINEUPS'] as const;
  constructor(config: AppConfig) { super(); this.baseUrl = config.FLASHSCORE_BASE_URL; }
}
