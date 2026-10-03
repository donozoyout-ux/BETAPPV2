import type { AppConfig } from '../config.js';
import type { MatchOdds, NormalizedOdds, OddsProvider } from '../domain/odds.js';
import type { Logger } from '../logger.js';
import { check } from '../qualification/helpers.js';
import { providerCapabilities, type ProviderQualification, type QualifiableProvider } from '../qualification/types.js';
import type { ProviderHealth } from '../live/types.js';
import { ProviderHttpError } from './http-client.js';

type TheOddsApiMarketKey = 'h2h' | 'spreads' | 'totals' | 'outright' | 'alternative';

const marketMapping: Record<TheOddsApiMarketKey, { marketType: string; marketName: string }> = {
  h2h: { marketType: 'MATCH_RESULT', marketName: '1X2' },
  spreads: { marketType: 'ASIAN_HANDICAP', marketName: 'Asian Handicap' },
  totals: { marketType: 'TOTAL_GOALS', marketName: 'Total Goals' },
  outright: { marketType: 'MATCH_RESULT', marketName: '1X2' },
  alternative: { marketType: 'MATCH_RESULT', marketName: '1X2' },
};

function parseFloat(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 1 ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
  }
  return null;
}

function normalizeSelection(value: string, marketType: string): string {
  const upper = value.toUpperCase();
  if (/^(DRAW|BERABERLIK|EV|EV_SAHIBI|EV_SAHİBİ)$/i.test(value)) return 'DRAW';
  if (/^(HOME|EV_SAHIBI|EV|EV_SAHİBİ)$/i.test(value) || marketType === 'ASIAN_HANDICAP' && /^(HOME|EV_SAHIBI|EV)/i.test(value)) return 'HOME';
  if (/^(AWAY|DEPLASMAN)$/i.test(value) || marketType === 'ASIAN_HANDICAP' && /^(AWAY|DEPLASMAN)/i.test(value)) return 'AWAY';
  if (/^(OVER|UST)$/i.test(value)) return 'OVER';
  if (/^(UNDER|ALT)$/i.test(value)) return 'UNDER';
  return upper.replace(/\s+/g, '_');
}

function normalizeTheOddsApiBooks(bookmakers: unknown[], fixture: TheOddsApiFixture, capturedAt: Date): NormalizedOdds[] {
  const odds: NormalizedOdds[] = [];
  for (const bookmaker of bookmakers) {
    const bookmakerObj = bookmaker as Record<string, unknown>;
    const bookmakerKey = typeof bookmakerObj.key === 'string' ? bookmakerObj.key.toLowerCase() : '';
    const bookmakerName = bookmakerKey.trim() || 'unknown';
    const lastUpdate = typeof bookmakerObj.last_update === 'number' ? bookmakerObj.last_update * 1000 : null;

    const markets = Array.isArray(bookmakerObj.markets) ? bookmakerObj.markets as Record<string, unknown>[] : [];
    for (const market of markets) {
      const marketObj = market as Record<string, unknown>;
      const marketKey = typeof marketObj.key === 'string' ? marketObj.key as TheOddsApiMarketKey : undefined;
      const mapping = marketKey && marketMapping[marketKey] ? marketMapping[marketKey] : null;
      if (!mapping) continue;

      const outcomes = Array.isArray(marketObj.outcomes) ? marketObj.outcomes as Record<string, unknown>[] : [];
      for (const outcome of outcomes) {
        const outcomeObj = outcome as Record<string, unknown>;
        const price = parseFloat(outcomeObj.price);
        const selectionRaw = typeof outcomeObj.name === 'string' ? outcomeObj.name : '';
        if (price == null || price <= 1) continue;

        const selection = normalizeSelection(selectionRaw, mapping.marketType);
        if (!selection) continue;

        odds.push({
          provider: `the-odds-api:${bookmakerName}`,
          providerMatchId: fixture.id,
          marketType: mapping.marketType,
          marketName: mapping.marketName,
          line: null,
          selection,
          oddsDecimal: price,
          capturedAt: lastUpdate ? new Date(lastUpdate) : capturedAt,
        });
      }
    }
  }
  return odds;
}

type TheOddsApiFixture = { id: string };

type TheOddsApiResponse = {
  success: boolean;
  bookmakers: Array<{
    key: string;
    last_update: number;
    markets: Array<{
      key: TheOddsApiMarketKey;
      last_update: number;
      outcomes: Array<{
        name: string;
        price: number;
      }>;
    }>;
  }>;
};

function getSportFromConfig(config: AppConfig): string {
  const sport = config.THE_ODDS_API_SPORT?.trim();
  return sport || 'soccer';
}

function getMarketFromConfig(config: AppConfig): string {
  const markets = config.THE_ODDS_API_MARKETS?.trim();
  return markets || 'h2h,totals,spreads';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TheOddsApiClient {
  private nextAllowedAt = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getJson<T>(path: string, onHttpResponse?: (status: number) => void): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.PROVIDER_TIMEOUT_MS);

    try {
      const delay = Math.max(0, this.nextAllowedAt - Date.now());
      if (delay > 0) await sleep(delay);
      this.nextAllowedAt = Date.now() + Math.ceil(1000 / this.config.PROVIDER_REQUESTS_PER_SECOND);

      const url = `https://api.the-odds-api.com/v4${path}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'BETAPP-V2/2.0 (+data-collector)',
          'x-api-key': this.config.THE_ODDS_API_KEY,
        },
      });

      onHttpResponse?.(response.status);

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new ProviderHttpError(`The Odds API returned HTTP ${response.status}`, response.status, retryable);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      throw new ProviderHttpError('The Odds API request failed', undefined, true);
    } finally {
      clearTimeout(timer);
    }
  }

  consumeRetryCount(): number {
    return 0;
  }
}

export class TheOddsApiProvider implements OddsProvider, QualifiableProvider {
  readonly name = 'the-odds-api';
  readonly configured: boolean;
  private health: ProviderHealth = 'NOT_CONFIGURED';
  private http!: TheOddsApiClient;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.configured = config.THE_ODDS_API_ENABLED && Boolean(config.THE_ODDS_API_KEY.trim());
    if (this.configured) {
      this.http = new TheOddsApiClient(config, logger);
    }
  }

  async qualify(): Promise<ProviderQualification> {
    if (!this.configured) {
      return {
        provider: this.name,
        connection: 'NOT_TESTED' as const,
        checks: providerCapabilities.map((capability) => check(capability, 'NOT_TESTED' as const, '', { httpStatus: null, parseSuccess: false, notes: '' })),
      };
    }

    try {
      await this.http.getJson('/');
      return {
        provider: this.name,
        connection: 'SUPPORTED' as const,
        checks: providerCapabilities.map((capability) =>
          check(capability, 'SUPPORTED' as const, 'https://api.the-odds-api.com/v4', { httpStatus: 200, parseSuccess: true, notes: '' }),
        ),
      };
    } catch (error) {
      const httpStatus = error instanceof ProviderHttpError ? error.status : null;
      return {
        provider: this.name,
        connection: 'UNAVAILABLE' as const,
        checks: providerCapabilities.map((capability) =>
          check(capability, 'UNAVAILABLE' as const, 'https://api.the-odds-api.com/v4', { httpStatus: httpStatus as number | null, parseSuccess: false, notes: error instanceof Error ? error.message : String(error) }),
        ),
      };
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.configured) return 'NOT_CONFIGURED';

    try {
      await this.http.getJson('/');
      this.health = 'SUPPORTED';
    } catch (error) {
      const httpStatus = error instanceof ProviderHttpError ? error.status : null;
      if (httpStatus === 401 || httpStatus === 403) {
        this.health = 'UNAVAILABLE';
      } else if (httpStatus === 429) {
        this.health = 'RATE_LIMITED';
      } else {
        this.health = 'DEGRADED';
      }
    }
    return this.health;
  }

  async getFixtures(): Promise<unknown[]> {
    return [];
  }

  async getMatchStatistics(): Promise<unknown> {
    return {};
  }

  async getPrematchOddsForDate(_date: Date): Promise<MatchOdds[]> {
    // The Odds API doesn't support date-specific filtering in the same way
    // as Nowgoal - return empty for now, collector will handle gracefully
    return [];
  }

  async getPrematchOdds(): Promise<NormalizedOdds[]> {
    if (!this.configured) return [];

    try {
      const sport = getSportFromConfig(this.config);
      const markets = getMarketFromConfig(this.config);
      const url = `/sports/${encodeURIComponent(sport)}/odds?markets=${encodeURIComponent(markets)}`;

      const response = await this.http.getJson<TheOddsApiResponse>(url);
      if (!response?.success || !response.bookmakers || !Array.isArray(response.bookmakers)) {
        return [];
      }

      const capturedAt = new Date();
      const odds = normalizeTheOddsApiBooks(response.bookmakers, { id: 'fixture-' + Date.now() }, capturedAt);

      if (odds.length > 0) {
        this.health = 'SUPPORTED';
      }

      return odds;
    } catch (error) {
      const httpStatus = error instanceof ProviderHttpError ? error.status : null;
      if (httpStatus === 401 || httpStatus === 403) {
        this.health = 'UNAVAILABLE';
      } else if (httpStatus === 429) {
        this.health = 'RATE_LIMITED';
      } else {
        this.health = 'DEGRADED';
      }
      return [];
    }
  }
}