import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { MatchOdds, NormalizedOdds, OddsFixture, OddsProvider } from '../domain/odds.js';
import type { Logger } from '../logger.js';
import { check, statusFromError } from '../qualification/helpers.js';
import { providerCapabilities, type ProviderQualification, type QualifiableProvider } from '../qualification/types.js';
import { ProviderHttpError, ResilientHttpClient } from './http-client.js';

type NowgoalMatch = {
  ScheduleID?: string;
  matchTime?: string;
  homeTeam?: string;
  guestTeam?: string;
  MatchState?: number;
  sclassID?: string;
};

type NowgoalLeague = { sclassID?: string; leagueName?: string };
type MatchDiaryResponse = { data?: { matches?: NowgoalMatch[]; leagues?: NowgoalLeague[] } };

export type NowgoalOddsRow = {
  ScheduleID?: string;
  CompanyID?: number;
  Type?: string;
  UpOdds?: string | number;
  Goal?: string | number;
  DownOdds?: string | number;
};

type OddsDiaryResponse = { data?: NowgoalOddsRow[] };

export const nowgoalCompanies: Readonly<Record<number, string>> = {
  2: 'bet365', 3: 'crown', 4: '10bet', 5: 'ladbrokes', 8: 'snai', 9: 'william_hill',
  12: 'eurobet', 13: 'interwetten', 14: '12bet', 15: 'sbobet', 17: '18bet',
  18: 'fun88', 21: '188bet', 22: 'pinnacle', 136: 'hkjc',
};

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function decimal(value: unknown, hongKong: boolean): number | null {
  const parsed = number(value);
  if (parsed == null) return null;
  const result = Math.round((hongKong ? parsed + 1 : parsed) * 10_000) / 10_000;
  return result > 1 && result <= 1000 ? result : null;
}

function normalized(
  row: NowgoalOddsRow,
  bookmaker: string,
  marketType: string,
  marketName: string,
  line: number | null,
  selection: string,
  oddsDecimal: number | null,
  capturedAt: Date,
): NormalizedOdds[] {
  if (!row.ScheduleID || oddsDecimal == null) return [];
  return [{ provider: `nowgoal:${bookmaker}`, providerMatchId: row.ScheduleID, marketType, marketName,
    line, selection, oddsDecimal, capturedAt }];
}

export function normalizeNowgoalOddsRows(
  rows: NowgoalOddsRow[],
  companyNames: Readonly<Record<number, string>> = nowgoalCompanies,
  capturedAt = new Date(),
): NormalizedOdds[] {
  return rows.flatMap((row) => {
    const companyId = number(row.CompanyID);
    if (companyId == null) return [];
    const bookmaker = companyNames[companyId] ?? `company_${companyId}`;
    const line = number(row.Goal);
    switch (row.Type) {
      case '1x2':
        return [
          ...normalized(row, bookmaker, 'MATCH_RESULT', '1X2', null, 'HOME', decimal(row.UpOdds, false), capturedAt),
          ...normalized(row, bookmaker, 'MATCH_RESULT', '1X2', null, 'DRAW', decimal(row.Goal, false), capturedAt),
          ...normalized(row, bookmaker, 'MATCH_RESULT', '1X2', null, 'AWAY', decimal(row.DownOdds, false), capturedAt),
        ];
      case 'HDP':
        return [
          ...normalized(row, bookmaker, 'ASIAN_HANDICAP', 'Asian Handicap', line, 'HOME', decimal(row.UpOdds, true), capturedAt),
          ...normalized(row, bookmaker, 'ASIAN_HANDICAP', 'Asian Handicap', line, 'AWAY', decimal(row.DownOdds, true), capturedAt),
        ];
      case 'OU':
        return [
          ...normalized(row, bookmaker, 'TOTAL_GOALS', 'Total Goals', line, 'OVER', decimal(row.UpOdds, true), capturedAt),
          ...normalized(row, bookmaker, 'TOTAL_GOALS', 'Total Goals', line, 'UNDER', decimal(row.DownOdds, true), capturedAt),
        ];
      case 'CR':
        return [
          ...normalized(row, bookmaker, 'TOTAL_CORNERS', 'Total Corners', line, 'OVER', decimal(row.UpOdds, true), capturedAt),
          ...normalized(row, bookmaker, 'TOTAL_CORNERS', 'Total Corners', line, 'UNDER', decimal(row.DownOdds, true), capturedAt),
        ];
      default:
        return [];
    }
  });
}

function dateOnly(date: Date): string { return date.toISOString().slice(0, 10); }

function safeFixtureRef(providerMatchId: string | undefined): string | null {
  return providerMatchId ? createHash('sha256').update(providerMatchId).digest('hex').slice(0, 12) : null;
}

function parseUtc(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

export class NowgoalProvider implements OddsProvider, QualifiableProvider {
  readonly name = 'nowgoal';
  private readonly http: ResilientHttpClient;
  private readonly companyIds: number[];

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.companyIds = config.NOWGOAL_COMPANY_IDS;
    const baseUrls = [...new Set([config.NOWGOAL_BASE_URL, ...config.NOWGOAL_FALLBACK_BASE_URLS])]
      .map((url) => url.replace(/\/$/, ''));
    this.http = new ResilientHttpClient({ baseUrl: baseUrls[0]!,
      timeoutMs: config.PROVIDER_TIMEOUT_MS, requestsPerSecond: config.PROVIDER_REQUESTS_PER_SECOND,
      maxRetries: config.PROVIDER_MAX_RETRIES, logger });
    this.fallbackClients = baseUrls.slice(1).map((baseUrl) => ({
      baseUrl,
      http: new ResilientHttpClient({ baseUrl, timeoutMs: config.PROVIDER_TIMEOUT_MS,
        requestsPerSecond: config.PROVIDER_REQUESTS_PER_SECOND, maxRetries: config.PROVIDER_MAX_RETRIES, logger }),
    }));
  }

  private proxyPath(path: string): string { return `?path=${encodeURIComponent(path)}`; }

  private async requestJson<T>(path: string, date: Date, requestType: string): Promise<{ payload: T; status: number | null }> {
    this.logger.info({ event: 'PREMATCH_PROVIDER_REQUEST', provider: this.name, date: dateOnly(date), requestType },
      'PREMATCH_PROVIDER_REQUEST');
    const clients = [{ baseUrl: this.config.NOWGOAL_BASE_URL.replace(/\/$/, ''), http: this.http }, ...this.fallbackClients];
    let lastError: unknown;
    for (let index = 0; index < clients.length; index += 1) {
      const candidate = clients[index]!;
      let status: number | null = null;
      try {
        const payload = await candidate.http.getJson<T>(path, (responseStatus) => { status = responseStatus; });
        if (index > 0) {
          this.logger.warn({ event: 'NOWGOAL_FAILOVER_SELECTED', provider: this.name,
            baseHost: new URL(candidate.baseUrl).hostname, requestType }, 'NOWGOAL_FAILOVER_SELECTED');
        }
        return { payload, status };
      } catch (error) {
        lastError = error;
        const errorStatus = error instanceof ProviderHttpError ? error.status ?? status : status;
        this.logger.warn({ event: 'NOWGOAL_FAILOVER_ATTEMPT', provider: this.name,
          baseHost: new URL(candidate.baseUrl).hostname, requestType, httpStatus: errorStatus,
          attempt: index + 1, remaining: clients.length - index - 1,
          errorClass: error instanceof Error ? error.name : 'UnknownError' }, 'NOWGOAL_FAILOVER_ATTEMPT');
        if (index === clients.length - 1) {
          this.logger.warn({ event: 'PREMATCH_PROVIDER_RESPONSE', provider: this.name, date: dateOnly(date), requestType,
            httpStatus: errorStatus, requestSuccess: false, count: 0,
            errorClass: error instanceof Error ? error.name : 'UnknownError' }, 'PREMATCH_PROVIDER_RESPONSE');
        }
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderHttpError('Nowgoal provider unavailable');
  }

  private logResponse(date: Date, requestType: string, status: number | null, count: number) {
    this.logger.info({ event: 'PREMATCH_PROVIDER_RESPONSE', provider: this.name, date: dateOnly(date), requestType,
      httpStatus: status, requestSuccess: status != null && status >= 200 && status < 300, count },
    'PREMATCH_PROVIDER_RESPONSE');
  }

  async getPrematchOddsForDate(date: Date): Promise<MatchOdds[]> {
    const query = `date=${dateOnly(date)}&timeRange=all&lang=en&ishot=0&halfOdd=0`;
    const matchRequest = await this.requestJson<MatchDiaryResponse>(
      this.proxyPath(`/v1/football/match/diary?${query}`), date, 'fixture_diary');
    const matchPayload = matchRequest.payload;
    this.logResponse(date, 'fixture_diary', matchRequest.status, matchPayload.data?.matches?.length ?? 0);
    const capturedAt = new Date();
    const oddsPayloads = await Promise.all(this.companyIds.map(async (companyId) => {
      const request = await this.requestJson<OddsDiaryResponse>(
        this.proxyPath(`/v1/football/odds/diary?${query}&companyid=${companyId}`), date, 'odds_diary');
      this.logResponse(date, 'odds_diary', request.status, request.payload.data?.length ?? 0);
      return request.payload;
    }));
    const sourceRows = oddsPayloads.flatMap((payload) => payload.data ?? []);
    const odds = normalizeNowgoalOddsRows(sourceRows, nowgoalCompanies, capturedAt);
    const oddsByMatch = new Map<string, NormalizedOdds[]>();
    for (const item of odds) oddsByMatch.set(item.providerMatchId, [...(oddsByMatch.get(item.providerMatchId) ?? []), item]);
    const leagues = new Map((matchPayload.data?.leagues ?? []).flatMap((league) =>
      league.sclassID ? [[league.sclassID, league.leagueName ?? null] as const] : []));
    const matches = matchPayload.data?.matches ?? [];
    const candidates: MatchOdds[] = [];
    for (const match of matches) {
      const fixtureRef = safeFixtureRef(match.ScheduleID);
      const competition = match.sclassID ? (leagues.get(match.sclassID) ?? null) : null;
      const status = match.MatchState === 0 ? 'scheduled' : String(match.MatchState ?? 'unknown');
      if (match.MatchState !== 0) {
        this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', fixtureRef, competition, kickoff: match.matchTime ?? null,
          provider: this.name, status, reason: 'NOT_UPCOMING', count: 0 }, 'PREMATCH_FIXTURE_SKIPPED');
        continue;
      }
      if (!match.ScheduleID || !match.matchTime || !match.homeTeam || !match.guestTeam) {
        this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', fixtureRef, competition, kickoff: match.matchTime ?? null,
          provider: this.name, status, reason: 'INVALID_FIXTURE', count: 0 }, 'PREMATCH_FIXTURE_SKIPPED');
        continue;
      }
      const matchOdds = oddsByMatch.get(match.ScheduleID) ?? [];
      if (!matchOdds.length) {
        this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', fixtureRef, competition, kickoff: match.matchTime,
          provider: this.name, status, reason: 'NO_ODDS', count: 0 }, 'PREMATCH_FIXTURE_SKIPPED');
        continue;
      }
      const fixture: OddsFixture = { providerMatchId: match.ScheduleID, kickoffAt: parseUtc(match.matchTime),
        homeTeam: match.homeTeam, awayTeam: match.guestTeam, leagueName: competition };
      if (Number.isNaN(fixture.kickoffAt.getTime())) {
        this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', fixtureRef, competition, kickoff: match.matchTime,
          provider: this.name, status, reason: 'INVALID_FIXTURE', count: 0 }, 'PREMATCH_FIXTURE_SKIPPED');
        continue;
      }
      candidates.push({ fixture, odds: matchOdds });
      this.logger.info({ event: 'PREMATCH_FIXTURE_CANDIDATE', fixtureRef, competition,
        kickoff: fixture.kickoffAt.toISOString(), provider: this.name, status, count: matchOdds.length },
      'PREMATCH_FIXTURE_CANDIDATE');
    }
    this.logger.info({ event: 'PREMATCH_ODDS_NORMALIZED', provider: this.name, date: dateOnly(date),
      sourceRowCount: sourceRows.length, normalizedQuoteCount: odds.length, candidateCount: candidates.length },
    'PREMATCH_ODDS_NORMALIZED');
    return candidates;
  }

  async getPrematchOdds(): Promise<NormalizedOdds[]> {
    return (await this.getPrematchOddsForDate(new Date())).flatMap((match) => match.odds);
  }

  consumeRetryCount() { return this.http.consumeRetryCount() + this.fallbackClients.reduce((sum, item) => sum + item.http.consumeRetryCount(), 0); }

  async healthCheck() {
    const startedAt = Date.now();
    try {
      const query = `date=${dateOnly(new Date())}&timeRange=all&lang=en&ishot=0&halfOdd=0`;
      const response = await this.requestJson<MatchDiaryResponse>(
        this.proxyPath(`/v1/football/match/diary?${query}`), new Date(), 'fixture_diary_health');
      const sample = response.payload;
      const count = sample.data?.matches?.length ?? 0;
      this.logResponse(new Date(), 'fixture_diary_health', response.status, count);
      return { provider: this.name, ok: true, checkedAt: new Date(), latencyMs: Date.now() - startedAt,
        message: `${count} fixtures reachable` };
    } catch (error) {
      return { provider: this.name, ok: false, checkedAt: new Date(), latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error) };
    }
  }

  async qualify(): Promise<ProviderQualification> {
    const source = this.config.NOWGOAL_BASE_URL;
    const started = Date.now();
    try {
      const matches = await this.getPrematchOddsForDate(new Date());
      const odds = matches.flatMap((match) => match.odds);
      const marketTypes = new Set(odds.map((item) => item.marketType));
      const latencyMs = Date.now() - started;
      const checks = providerCapabilities.map((capability) => {
        const fixtureCapability = capability === 'FIXTURES' || capability === 'TEAM_INFO' || capability === 'LEAGUE_INFO';
        const prematch = capability === 'PREMATCH_ODDS';
        const markets = capability === 'ODDS_MARKETS';
        if (fixtureCapability || prematch || markets) {
          const ok = fixtureCapability ? matches.length > 0 : prematch ? odds.length > 0 : marketTypes.size >= 2;
          return check(capability, ok ? 'SUPPORTED' : 'UNAVAILABLE', source, { httpStatus: 200, latencyMs,
            sampleCount: fixtureCapability ? matches.length : odds.length, parseSuccess: ok,
            notes: markets ? `Markets: ${[...marketTypes].sort().join(', ') || 'none'}` : null });
        }
        if (capability === 'LIVE_ODDS') return check(capability, 'NOT_TESTED', source, { httpStatus: 200, latencyMs,
          notes: 'V1 collector yalnızca pre-match oranları saklar' });
        return check(capability, 'NOT_TESTED', source, { httpStatus: 200, latencyMs,
          notes: 'Nowgoal yalnızca odds provider rolünde kullanılıyor' });
      });
      return { provider: this.name, connection: odds.length ? 'SUPPORTED' : 'UNAVAILABLE', checks };
    } catch (error) {
      const httpStatus = statusFromError(error);
      const result = httpStatus === 403 || httpStatus === 429 ? 'BLOCKED' : 'UNAVAILABLE';
      return { provider: this.name, connection: result, checks: providerCapabilities.map((capability) =>
        check(capability, result, source, { httpStatus, latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error) })) };
    }
  }
}
