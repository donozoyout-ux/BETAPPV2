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
  const upper = value.trim().toUpperCase();
  if (/^(HOME|EV|EV_SAHIBI|EV_SAHİBİ)$/.test(upper)) return 'HOME';
  if (/^(DRAW|BERABERLIK|BERABERLİK|X)$/.test(upper)) return 'DRAW';
  if (/^(AWAY|DEPLASMAN|DEPLASMAN_TAKIMI)$/.test(upper)) return 'AWAY';
  if (/^(OVER|UST|ÜST)$/.test(upper)) return 'OVER';
  if (/^(UNDER|ALT)$/.test(upper)) return 'UNDER';
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
      const marketLastUpdate = typeof marketObj.last_update === 'string'
        ? new Date(marketObj.last_update)
        : typeof marketObj.last_update === 'number'
          ? new Date(marketObj.last_update * 1000)
          : null;
      for (const outcome of outcomes) {
        const outcomeObj = outcome as Record<string, unknown>;
        const price = parseFloat(outcomeObj.price);
        const selectionRaw = typeof outcomeObj.name === 'string' ? outcomeObj.name : '';
        if (price == null || price <= 1 || !selectionRaw) continue;

        const selection = normalizeSelection(selectionRaw, mapping.marketType);
        if (!selection) continue;
        const point = typeof outcomeObj.point === 'number'
          ? outcomeObj.point
          : typeof outcomeObj.point === 'string' && outcomeObj.point.trim() !== ''
            ? Number(outcomeObj.point)
            : null;

        odds.push({
          provider: `the-odds-api:${bookmakerName}`,
          providerMatchId: fixture.id,
          marketType: mapping.marketType,
          marketName: mapping.marketName,
          line: Number.isFinite(point) ? point : null,
          selection,
          oddsDecimal: price,
          capturedAt: marketLastUpdate && !Number.isNaN(marketLastUpdate.getTime())
            ? marketLastUpdate
            : lastUpdate && !Number.isNaN(lastUpdate.getTime())
              ? new Date(lastUpdate)
              : capturedAt,
        });
      }
    }
  }
  return odds;
}

type TheOddsApiFixture = {
  id: string;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
};

type TheOddsApiResponse = Array<{
  id: string;
  sport_key?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Array<{
    key: string;
    title?: string;
    last_update?: string | number;
    markets?: Array<{
      key: TheOddsApiMarketKey;
      last_update?: string | number;
      outcomes?: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}>;

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
      await this.http.getJson('/sports/soccer/scores?daysFrom=1');
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

  async getPrematchOddsForDate(date: Date): Promise<MatchOdds[]> {
    if (!this.configured) return [];

    try {
      const sport = getSportFromConfig(this.config);
      const markets = getMarketFromConfig(this.config);
      const from = new Date(date);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      const params = new URLSearchParams({
        markets,
        regions: this.config.THE_ODDS_API_REGIONS,
        oddsFormat: 'decimal',
        dateFormat: 'iso',
        commenceTimeFrom: from.toISOString(),
        commenceTimeTo: to.toISOString(),
      });
      const response = await this.http.getJson<TheOddsApiResponse>(
        `/sports/${encodeURIComponent(sport)}/odds?${params.toString()}`,
      );
      if (!Array.isArray(response)) return [];

      const capturedAt = new Date();
      const matches: MatchOdds[] = [];
      for (const event of response) {
        if (!event?.id || !event.home_team || !event.away_team || !event.commence_time) continue;
        const kickoffAt = new Date(event.commence_time);
        if (Number.isNaN(kickoffAt.getTime())) continue;
        const odds = normalizeTheOddsApiBooks(event.bookmakers ?? [], { id: event.id }, capturedAt);
        if (!odds.length) continue;
        matches.push({
          fixture: {
            providerMatchId: event.id,
            kickoffAt,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            leagueName: event.sport_key ?? null,
          },
          odds,
        });
      }
      if (matches.length) this.health = 'SUPPORTED';
      return matches;
    } catch (error) {
      const httpStatus = error instanceof ProviderHttpError ? error.status : null;
      if (httpStatus === 401 || httpStatus === 403) this.health = 'UNAVAILABLE';
      else if (httpStatus === 429) this.health = 'RATE_LIMITED';
      else this.health = 'DEGRADED';
      return [];
    }
  }

  async getPrematchOdds(): Promise<NormalizedOdds[]> {
    return (await this.getPrematchOddsForDate(new Date())).flatMap((match) => match.odds);
  }
}