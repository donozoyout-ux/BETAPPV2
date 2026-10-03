import { createHash } from 'node:crypto';
import { z } from 'zod';
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
  if (value.includes(',')) {
    const p = value.split(',').map(Number);
    return new Date(Date.UTC(p[0]!, p[1]!, p[2]!, p[3] ?? 0, p[4] ?? 0, p[5] ?? 0));
  }
  return new Date(`${value.replace(' ', 'T')}Z`);
}

export const nowgoalDirectResponseSchema = z.object({
  ErrCode: z.number().optional(),
  Data: z.string().optional(),
});

type ParsedScalar = string | number | boolean | null;
type ParsedValue = ParsedScalar | ParsedValue[];

// Deterministic, non-executing reader for the fixture diary payload. The provider
// returns JavaScript-like array assignments (A[i]=[...]; B[i]=[...]). We read only
// array literals and ignore every other token, so no remote code is ever evaluated.
function parseJsArrayLiteral(input: string, start: number): { value: ParsedValue[]; next: number } | null {
  if (input[start] !== '[') return null;
  const value: ParsedValue[] = [];
  let i = start + 1;
  let expectValue = true;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i += 1;
    if (i >= input.length) return null;
    const ch = input[i]!;
    if (ch === ']') return { value, next: i + 1 };
    if (ch === ',') {
      if (expectValue) value.push(null);
      expectValue = true;
      i += 1;
      continue;
    }
    if (ch === '[') {
      const nested = parseJsArrayLiteral(input, i);
      if (!nested) return null;
      value.push(nested.value);
      i = nested.next;
      expectValue = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let text = '';
      i += 1;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          const escaped = input[i + 1]!;
          text += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          i += 2;
        } else {
          text += input[i];
          i += 1;
        }
      }
      if (i >= input.length) return null;
      i += 1;
      value.push(text);
      expectValue = false;
      continue;
    }
    let end = i;
    while (end < input.length && input[end] !== ',' && input[end] !== ']') end += 1;
    const token = input.slice(i, end).trim();
    i = end;
    if (token === 'true') value.push(true);
    else if (token === 'false') value.push(false);
    else if (token === '' || token === 'null' || token === 'undefined') value.push(null);
    else if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) value.push(Number(token));
    else value.push(token);
    expectValue = false;
  }
  return null;
}

export function parseNowgoalFixtureDiary(data: string): { matches: unknown[][]; leagues: unknown[][] } {
  const matches: unknown[][] = [];
  const leagues: unknown[][] = [];
  const assignment = /(?:^|[;{}\s])([AB])\s*(?:\[\s*(\d+)\s*\])?\s*=\s*\[/g;
  let found: RegExpExecArray | null;
  while ((found = assignment.exec(data)) !== null) {
    const name = found[1];
    if (name !== 'A' && name !== 'B') continue;
    const index = found[2] != null ? Number(found[2]) : null;
    const bracketStart = found.index + found[0].length - 1;
    const parsed = parseJsArrayLiteral(data, bracketStart);
    if (!parsed) continue;
    const bucket = name === 'A' ? matches : leagues;
    if (index != null && Number.isFinite(index)) bucket[index] = parsed.value;
    else if (parsed.value.length) bucket.push(parsed.value);
    assignment.lastIndex = parsed.next;
  }
  return { matches, leagues };
}

export function parseNowgoalType4Odds(
  data: string,
  nowgoalMatchId: string,
  companyNames: Readonly<Record<number, string>> = nowgoalCompanies,
  capturedAt = new Date(),
): NormalizedOdds[] {
  const normalizedOdds: NormalizedOdds[] = [];
  for (const companyBlock of data.split('!')) {
    const split = companyBlock.indexOf('#');
    if (split < 0) continue;
    const [providerId, bookmakerIdStr, bookmakerName] = companyBlock.slice(0, split).split(',');
    if (providerId !== nowgoalMatchId || !bookmakerIdStr) continue;
    const companyId = Number(bookmakerIdStr);
    const bookmaker = (companyNames[companyId] ?? bookmakerName?.trim() ?? `company_${companyId}`)
      .toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const rawRows = companyBlock.slice(split + 1).split('^');
    for (const rawRow of rawRows) {
      const row = rawRow.split(',');
      if (row.length < 36) continue;
      const num = (v: string | undefined): number | null => {
        if (!v || v.trim() === '') return null;
        const p = Number(v.trim().replace(',', '.'));
        return Number.isFinite(p) ? p : null;
      };
      const oddsVal = (v: string | undefined): number | null => {
        const p = num(v);
        return p != null && p > 1 && p <= 1000 ? p : null;
      };
      const hkOddsVal = (v: string | undefined): number | null => {
        const p = num(v);
        return p != null && p > 0 && p <= 1000 ? Math.round((p + 1) * 10_000) / 10_000 : null;
      };

      const h1x2 = oddsVal(row[33]);
      const d1x2 = oddsVal(row[34]);
      const a1x2 = oddsVal(row[35]);
      if (h1x2 != null && d1x2 != null && a1x2 != null) {
        normalizedOdds.push(
          { provider: `nowgoal:${bookmaker}`, providerMatchId: nowgoalMatchId, marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME', oddsDecimal: h1x2, capturedAt },
          { provider: `nowgoal:${bookmaker}`, providerMatchId: nowgoalMatchId, marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'DRAW', oddsDecimal: d1x2, capturedAt },
          { provider: `nowgoal:${bookmaker}`, providerMatchId: nowgoalMatchId, marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'AWAY', oddsDecimal: a1x2, capturedAt },
        );
      }

      const ahHome = hkOddsVal(row[9]);
      const ahLine = num(row[10]);
      const ahAway = hkOddsVal(row[11]);
      if (ahHome != null && ahAway != null && ahLine != null) {
        normalizedOdds.push(
          { provider: `nowgoal:${bookmaker}`, providerMatchId: nowgoalMatchId, marketType: 'ASIAN_HANDICAP', marketName: 'Asian Handicap', line: ahLine, selection: 'HOME', oddsDecimal: ahHome, capturedAt },
          { provider: `nowgoal:${bookmaker}`, providerMatchId: nowgoalMatchId, marketType: 'ASIAN_HANDICAP', marketName: 'Asian Handicap', line: ahLine, selection: 'AWAY', oddsDecimal: ahAway, capturedAt },
        );
      }

      const ouOver = hkOddsVal(row[21]);
      const ouLine = num(row[22]);
      const ouUnder = hkOddsVal(row[23]);
      if (ouOver != null && ouUnder != null && ouLine != null) {
        normalizedOdds.push(
          { provider: `nowgoal:${bookmaker}`, providerMatchId: nowgoalMatchId, marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: ouLine, selection: 'OVER', oddsDecimal: ouOver, capturedAt },
          { provider: `nowgoal:${bookmaker}`, providerMatchId: nowgoalMatchId, marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: ouLine, selection: 'UNDER', oddsDecimal: ouUnder, capturedAt },
        );
      }

      if (normalizedOdds.some((o) => o.provider === `nowgoal:${bookmaker}`)) break;
    }
  }
  return normalizedOdds;
}

export class NowgoalProvider implements OddsProvider, QualifiableProvider {
  readonly name = 'nowgoal';
  private readonly http: ResilientHttpClient;
  private readonly companyIds: number[];
  private readonly isDirect: boolean;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.companyIds = config.NOWGOAL_COMPANY_IDS;
    this.isDirect = !config.NOWGOAL_BASE_URL.includes('/proxy') && !config.NOWGOAL_BASE_URL.includes('wp-json');
    this.http = new ResilientHttpClient({ baseUrl: config.NOWGOAL_BASE_URL.replace(/\/$/, ''),
      timeoutMs: config.PROVIDER_TIMEOUT_MS, requestsPerSecond: config.PROVIDER_REQUESTS_PER_SECOND,
      maxRetries: config.PROVIDER_MAX_RETRIES, logger });
  }

  private proxyPath(path: string): string { return `?path=${encodeURIComponent(path)}`; }

  private async requestJson<T>(path: string, date: Date, requestType: string): Promise<{ payload: T; status: number | null }> {
    this.logger.info({ event: 'PREMATCH_PROVIDER_REQUEST', provider: this.name, date: dateOnly(date), requestType },
      'PREMATCH_PROVIDER_REQUEST');
    let status: number | null = null;
    try {
      const payload = await this.http.getJson<T>(path, (responseStatus) => { status = responseStatus; });
      return { payload, status };
    } catch (error) {
      const errorStatus = error instanceof ProviderHttpError ? error.status ?? status : status;
      this.logger.warn({ event: 'PREMATCH_PROVIDER_RESPONSE', provider: this.name, date: dateOnly(date), requestType,
        httpStatus: errorStatus, requestSuccess: false, count: 0,
        errorClass: error instanceof Error ? error.name : 'UnknownError' }, 'PREMATCH_PROVIDER_RESPONSE');
      throw error;
    }
  }

  private logResponse(date: Date, requestType: string, status: number | null, count: number) {
    this.logger.info({ event: 'PREMATCH_PROVIDER_RESPONSE', provider: this.name, date: dateOnly(date), requestType,
      httpStatus: status, requestSuccess: status != null && status >= 200 && status < 300, count },
    'PREMATCH_PROVIDER_RESPONSE');
  }

  async getPrematchOddsForDate(date: Date): Promise<MatchOdds[]> {
    if (this.isDirect) {
      return this.getPrematchOddsDirect(date);
    }
    return this.getPrematchOddsProxy(date);
  }

  private async getPrematchOddsDirect(date: Date): Promise<MatchOdds[]> {
    const url = `/Ajax/SoccerAjax?type=6&date=${dateOnly(date)}&p=${Date.now()}`;
    const matchRequest = await this.requestJson<unknown>(url, date, 'fixture_diary');
    const response = nowgoalDirectResponseSchema.safeParse(matchRequest.payload);
    if (!response.success) {
      this.logger.warn({ event: 'PREMATCH_FIXTURE_PARSE', provider: this.name, date: dateOnly(date),
        requestType: 'fixture_diary', reason: 'PARSE_ERROR', count: 0 }, 'PREMATCH_FIXTURE_PARSE');
      this.logResponse(date, 'fixture_diary', matchRequest.status, 0);
      return [];
    }
    const rawData = response.data.Data ?? '';
    const fixture = parseNowgoalFixtureDiary(rawData);
    const rawMatches = fixture.matches.filter(Boolean);
    const leagues = fixture.leagues;
    if (rawData && rawMatches.length === 0) {
      this.logger.warn({ event: 'PREMATCH_FIXTURE_PARSE', provider: this.name, date: dateOnly(date),
        requestType: 'fixture_diary', reason: 'NO_DATA', count: 0 }, 'PREMATCH_FIXTURE_PARSE');
    }
    this.logResponse(date, 'fixture_diary', matchRequest.status, rawMatches.length);

    const capturedAt = new Date();
    const scheduledMatches = rawMatches.filter((m) => m[7] === 0 && m[0] && m[4] && m[5]);
    const candidates: MatchOdds[] = [];
    let totalQuotes = 0;

    // Fetch type=4 odds for scheduled matches
    for (const m of scheduledMatches) {
      const scheduleId = String(m[0]);
      const leagueIndex = Number(m[1]);
      const leagueItem = leagues[leagueIndex] as unknown[] | undefined;
      const leagueName = leagueItem ? String(leagueItem[2] || leagueItem[1] || '') : null;
      const fixtureRef = safeFixtureRef(scheduleId);
      const homeTeam = String(m[4]);
      const awayTeam = String(m[5]);
      const kickoffStr = String(m[6] || '');
      const kickoffAt = parseUtc(kickoffStr);

      if (Number.isNaN(kickoffAt.getTime())) {
        this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', fixtureRef, competition: leagueName, kickoff: kickoffStr,
          provider: this.name, status: 'scheduled', reason: 'INVALID_FIXTURE', count: 0 }, 'PREMATCH_FIXTURE_SKIPPED');
        continue;
      }

      let odds: NormalizedOdds[] = [];
      try {
        const oddsReq = await this.requestJson<{ ErrCode?: number; Data?: string }>(
          `/Ajax/SoccerAjax?type=4&id=${scheduleId}&p=${Date.now()}`, date, 'odds_diary');
        if (oddsReq.payload?.Data) {
          odds = parseNowgoalType4Odds(oddsReq.payload.Data, scheduleId, nowgoalCompanies, capturedAt);
        }
        this.logResponse(date, 'odds_diary', oddsReq.status, odds.length);
      } catch {
        // Continue with next fixture if single odds request fails
      }

      if (!odds.length) {
        this.logger.info({ event: 'PREMATCH_FIXTURE_SKIPPED', fixtureRef, competition: leagueName,
          kickoff: kickoffAt.toISOString(), provider: this.name, status: 'scheduled', reason: 'NO_ODDS', count: 0 },
        'PREMATCH_FIXTURE_SKIPPED');
        continue;
      }

      totalQuotes += odds.length;
      const fixture: OddsFixture = { providerMatchId: scheduleId, kickoffAt, homeTeam, awayTeam, leagueName };
      candidates.push({ fixture, odds });
      this.logger.info({ event: 'PREMATCH_FIXTURE_CANDIDATE', fixtureRef, competition: leagueName,
        kickoff: kickoffAt.toISOString(), provider: this.name, status: 'scheduled', count: odds.length },
      'PREMATCH_FIXTURE_CANDIDATE');
    }

    this.logger.info({ event: 'PREMATCH_ODDS_NORMALIZED', provider: this.name, date: dateOnly(date),
      sourceRowCount: totalQuotes, normalizedQuoteCount: totalQuotes, candidateCount: candidates.length },
    'PREMATCH_ODDS_NORMALIZED');
    return candidates;
  }

  private async getPrematchOddsProxy(date: Date): Promise<MatchOdds[]> {
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

  consumeRetryCount() { return this.http.consumeRetryCount(); }

  async healthCheck() {
    const startedAt = Date.now();
    try {
      if (this.isDirect) {
        const url = `/Ajax/SoccerAjax?type=6&date=${dateOnly(new Date())}&p=${Date.now()}`;
        const response = await this.requestJson<{ ErrCode?: number; Data?: string }>(url, new Date(), 'fixture_diary_health');
        const ok = response.payload?.ErrCode === 0 && Boolean(response.payload?.Data);
        this.logResponse(new Date(), 'fixture_diary_health', response.status, ok ? 1 : 0);
        return { provider: this.name, ok, checkedAt: new Date(), latencyMs: Date.now() - startedAt,
          message: ok ? 'Direct SoccerAjax reachable' : 'Invalid response from SoccerAjax' };
      }
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
