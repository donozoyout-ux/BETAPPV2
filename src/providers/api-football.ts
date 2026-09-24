import type { AppConfig } from '../config.js';
import type { MatchOdds, NormalizedOdds, OddsFixture } from '../domain/odds.js';
import { isCompetitionConfigured } from '../matching/competition.js';
import { normalizeTeamAlias } from '../matching/team-alias.js';
import { arr, obj, num, str, type EventType, type LiveMatchEvent, type LiveOdd, type ProviderHealth, type SourceSnapshot } from '../live/types.js';
const leagueNames: Record<number, string> = { 39: 'Premier League', 140: 'La Liga', 78: 'Bundesliga', 135: 'Serie A',
  61: 'Ligue 1', 203: 'Süper Lig', 2: 'UEFA Champions League', 3: 'UEFA Europa League', 848: 'UEFA Conference League',
  71: 'Brasileirão Série A', 1: 'FIFA World Cup', 4: 'EURO', 960: 'EURO Qualification', 32: 'World Cup Qualification UEFA',
  9: 'Copa America', 34: 'World Cup Qualification CONMEBOL', 10: 'International Friendlies' };
export type ApiFixture = { snapshot: SourceSnapshot; league: string; kickoffAt: string; homeTeam: string; awayTeam: string;
  homeId: number; awayId: number };
export function apiFixture(value: unknown, observedAt: string): ApiFixture | null {
  const r = obj(value), f = obj(r.fixture), l = obj(r.league), t = obj(r.teams), h = obj(t.home), a = obj(t.away), status = obj(f.status);
  let league = leagueNames[Number(l.id)] ?? str(l.name);
  if (Number(l.id) === 5) {
    const group = str(l.round)?.match(/League ([ABCD])\b/i)?.[1]?.toUpperCase();
    league = group ? `UEFA Nations League ${group}` : undefined;
  }
  if (!league || num(f.id) == null || !str(f.date) || !Number.isFinite(Date.parse(String(f.date))) || !str(h.name) || !str(a.name) || num(h.id) == null || num(a.id) == null) return null;
  const code = String(status.short);
  const phases: Record<string, string> = { '1H': 'FIRST_HALF', HT: 'HALF_TIME', '2H': 'SECOND_HALF', ET: 'EXTRA_TIME', BT: 'EXTRA_TIME', P: 'PENALTIES', FT: 'FINISHED', AET: 'FINISHED', PEN: 'FINISHED' };
  return { snapshot: { provider: 'api-football', externalId: String(f.id),
    status: ['FT', 'AET', 'PEN'].includes(code) ? 'finished' : ['1H','HT','2H','ET','BT','P','LIVE','INT','SUSP'].includes(code) ? 'live' : 'scheduled',
    phase: phases[code] ?? 'UNKNOWN', homeScore: num(obj(r.goals).home), awayScore: num(obj(r.goals).away),
    minute: num(status.elapsed), addedTime: num(status.extra), observedAt },
    league, kickoffAt: String(f.date), homeTeam: String(h.name), awayTeam: String(a.name), homeId: Number(h.id), awayId: Number(a.id) };
}
export function apiEvents(rows: unknown, fixture: ApiFixture, matchId: string, observedAt: string): LiveMatchEvent[] {
  const kinds: Record<string, EventType> = { 'Normal Goal': 'GOAL', 'Own Goal': 'OWN_GOAL', Penalty: 'PENALTY_GOAL',
    'Missed Penalty': 'MISSED_PENALTY', 'Yellow Card': 'YELLOW_CARD', 'Red Card': 'RED_CARD', 'Yellow-Red Card': 'SECOND_YELLOW' };
  return arr(rows).flatMap(e => {
    const type = e.type === 'subst' ? 'SUBSTITUTION' : ['Goal','Card'].includes(String(e.type)) ? kinds[String(e.detail)] : undefined;
    if (!type) return [];
    const team = obj(e.team), time = obj(e.time);
    return [{ provider: 'api-football', providerEventId: e.id == null ? null : String(e.id), matchId, type,
      minute: num(time.elapsed), addedTime: num(time.extra),
      teamSide: team.id === fixture.homeId ? 'HOME' : team.id === fixture.awayId ? 'AWAY' : 'UNKNOWN',
      teamName: str(team.name), playerName: str(obj(e.player).name), assistName: str(obj(e.assist).name), detail: str(e.detail),
      scoreAfter: null, occurredAt: null, observedAt, raw: e } satisfies LiveMatchEvent];
  });
}
export function apiStatistics(rows: unknown, fixture: ApiFixture, observedAt: string) {
  const keys: Record<string, string> = { 'Total Shots': 'total_shots', 'Shots on Goal': 'shots_on_target', 'Ball Possession': 'ball_possession',
    'Corner Kicks': 'corners', Fouls: 'fouls_committed', 'Yellow Cards': 'yellow_cards', 'Red Cards': 'red_cards', expected_goals: 'expected_goals', 'Expected Goals': 'expected_goals' };
  const result = new Map<string, Record<string, unknown>>();
  for (const side of arr(rows)) {
    const id = obj(side.team).id;
    if (id !== fixture.homeId && id !== fixture.awayId) continue;
    for (const stat of arr(side.statistics)) {
      const key = keys[String(stat.type)]; if (!key) continue;
      const row = result.get(key) ?? { stat_key: key, provider: 'api-football', period: 'ALL', home_value: null, away_value: null, source_updated_at: observedAt };
      row[id === fixture.homeId ? 'home_value' : 'away_value'] = num(typeof stat.value === 'string' ? stat.value.replace('%', '') : stat.value);
      result.set(key, row);
    }
  }
  return [...result.values()];
}
export function apiLiveOdds(rows: unknown, fixture: ApiFixture, observedAt: string): LiveOdd[] {
  if (fixture.snapshot.status !== 'live') return [];
  return arr(rows).flatMap(row => {
    const status = obj(row.status);
    if (String(obj(row.fixture).id) !== fixture.snapshot.externalId || status.finished !== false || status.blocked !== false || status.stopped !== false) return [];
    return arr(row.odds).filter(market => market.suspended !== true).flatMap(market => arr(market.values).flatMap(v => {
      const odd = num(v.odd);
      if (!str(market.name) || !str(v.value) || odd == null || odd <= 1 || v.suspended === true) return [];
      return [{ provider: 'api-football' as const, bookmaker: str(obj(row.bookmaker).name), market: String(market.name),
        line: v.handicap == null ? null : String(v.handicap), selection: String(v.value), odds: odd, observedAt }];
    }));
  });
}

function apiPrematchSelection(betName: string, value: string, fixture: ApiFixture): {
  marketType: string; marketName: string; line: number | null; selection: string;
} | null {
  const bet = betName.trim().toLowerCase();
  const raw = value.trim();
  const normalized = normalizeTeamAlias(raw);
  if (['match winner','1x2','winner'].includes(bet)) {
    if (/^draw$/i.test(raw)) return { marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'DRAW' };
    if (/^home$/i.test(raw) || normalized === normalizeTeamAlias(fixture.homeTeam)) {
      return { marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME' };
    }
    if (/^away$/i.test(raw) || normalized === normalizeTeamAlias(fixture.awayTeam)) {
      return { marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'AWAY' };
    }
    return null;
  }
  if (/goals.*over.*under|over.*under.*goals/i.test(bet)) {
    const match = raw.match(/^(Over|Under)\s+(-?\d+(?:\.\d+)?)$/i);
    if (!match) return null;
    return { marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: Number(match[2]),
      selection: match[1]!.toUpperCase() };
  }
  if (/asian handicap|handicap result/i.test(bet)) {
    const side = normalized === normalizeTeamAlias(fixture.homeTeam) || /^home$/i.test(raw) ? 'HOME'
      : normalized === normalizeTeamAlias(fixture.awayTeam) || /^away$/i.test(raw) ? 'AWAY' : null;
    const lineMatch = raw.match(/(?:^|\s)([+-]?\d+(?:\.\d+)?)$/);
    if (!side || !lineMatch) return null;
    return { marketType: 'ASIAN_HANDICAP', marketName: 'Asian Handicap', line: Number(lineMatch[1]), selection: side };
  }
  if (/corner.*over.*under|over.*under.*corner/i.test(bet)) {
    const match = raw.match(/^(Over|Under)\s+(-?\d+(?:\.\d+)?)$/i);
    if (!match) return null;
    return { marketType: 'TOTAL_CORNERS', marketName: 'Total Corners', line: Number(match[2]),
      selection: match[1]!.toUpperCase() };
  }
  return null;
}

export function apiPrematchOdds(rows: unknown, fixture: ApiFixture, capturedAt = new Date()): NormalizedOdds[] {
  if (fixture.snapshot.status !== 'scheduled' || capturedAt >= new Date(fixture.kickoffAt)) return [];
  return arr(rows).flatMap((row) => {
    if (String(obj(row.fixture).id) !== fixture.snapshot.externalId) return [];
    return arr(row.bookmakers).flatMap((bookmaker) => {
      const bookmakerName = str(bookmaker.name);
      if (!bookmakerName) return [];
      return arr(bookmaker.bets).flatMap((bet) => {
        const betName = str(bet.name);
        if (!betName) return [];
        return arr(bet.values).flatMap((value) => {
          const odd = num(value.odd);
          const rawValue = str(value.value);
          if (odd == null || odd <= 1 || !rawValue) return [];
          const market = apiPrematchSelection(betName, rawValue, fixture);
          if (!market || market.line != null && !Number.isFinite(market.line)) return [];
          return [{
            provider: `api-football:${bookmakerName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
            providerMatchId: fixture.snapshot.externalId,
            ...market,
            oddsDecimal: odd,
            capturedAt,
          } satisfies NormalizedOdds];
        });
      });
    });
  });
}

export class ApiFootballProvider {
  health: ProviderHealth;
  private blockedUntil = 0;
  private failures = 0;
  private nextRequest = 0;
  private chain: Promise<void> = Promise.resolve();
  readonly configured: boolean;
  constructor(private readonly config: AppConfig) {
    this.configured = config.API_FOOTBALL_ENABLED && Boolean(config.API_FOOTBALL_KEY.trim());
    this.health = this.configured ? 'UNAVAILABLE' : 'NOT_CONFIGURED';
  }
  async request(path: string): Promise<unknown[]> {
    if (!this.configured) return [];
    // Serialize requests; no burst after quota exhaustion and no secrets in errors/logs.
    const previous = this.chain; let release!: () => void;
    this.chain = new Promise<void>(r => { release = r; });
    await previous;
    try {
      if (Date.now() < this.blockedUntil) throw new Error('API_FOOTBALL_BACKOFF');
      const delay = this.nextRequest - Date.now();
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      this.nextRequest = Date.now() + 6_100;
      const response = await fetch(`https://v3.football.api-sports.io${path}`, {
        headers: { 'x-apisports-key': this.config.API_FOOTBALL_KEY }, signal: AbortSignal.timeout(this.config.PROVIDER_TIMEOUT_MS),
      });
      if (response.status === 429) {
        this.health = 'RATE_LIMITED';
        const retry = num(response.headers.get('retry-after'));
        this.blockedUntil = Date.now() + Math.max(60_000 * 2 ** Math.min(this.failures++, 6), (retry ?? 0) * 1000);
        throw new Error('API_FOOTBALL_RATE_LIMITED');
      }
      if (!response.ok) throw new Error('API_FOOTBALL_UNAVAILABLE');
      const body = obj(await response.json());
      if (Object.keys(obj(body.errors)).length || (Array.isArray(body.errors) && body.errors.length) || !Array.isArray(body.response) || Number(obj(body.paging).total ?? 1) > 1) throw new Error('API_FOOTBALL_INCOMPLETE_RESPONSE');
      this.failures = 0; this.health = 'SUPPORTED';
      const daily = response.headers.get('x-ratelimit-requests-remaining');
      const minute = response.headers.get('x-ratelimit-remaining');
      if (daily === '0' || minute === '0') {
        this.health = 'RATE_LIMITED'; this.blockedUntil = Date.now() + (daily === '0' ? 86_400_000 : 60_000);
      }
      return body.response;
    } catch (error) {
      if (this.health !== 'RATE_LIMITED') {
        this.health = this.failures > 1 ? 'UNAVAILABLE' : 'DEGRADED';
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + Math.min(900_000, 30_000 * 2 ** this.failures++));
      }
      throw error;
    } finally { release(); }
  }
  private supportedFixture(fixture: ApiFixture) {
    return isCompetitionConfigured(fixture.league, this.config.SUPPORTED_COMPETITIONS);
  }

  async fixtures() {
    const rows = await this.request('/fixtures?live=all');
    const now = new Date().toISOString();
    return rows.map(r => apiFixture(r, now)).filter((f): f is ApiFixture => f != null && this.supportedFixture(f));
  }

  async fixturesForDate(date: Date) {
    if (!this.configured) return [];
    const day = date.toISOString().slice(0, 10);
    const rows = await this.request(`/fixtures?date=${encodeURIComponent(day)}`);
    const now = new Date().toISOString();
    return rows.map(r => apiFixture(r, now)).filter((f): f is ApiFixture =>
      f != null && f.snapshot.status === 'scheduled' && this.supportedFixture(f));
  }

  async prematchOdds(fixture: ApiFixture): Promise<MatchOdds> {
    const capturedAt = new Date();
    if (!this.configured || fixture.snapshot.status !== 'scheduled' || capturedAt >= new Date(fixture.kickoffAt)) {
      return { fixture: { providerMatchId: fixture.snapshot.externalId, kickoffAt: new Date(fixture.kickoffAt),
        homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, leagueName: fixture.league }, odds: [] };
    }
    const rows = await this.request(`/odds?fixture=${encodeURIComponent(fixture.snapshot.externalId)}`);
    const oddsFixture: OddsFixture = { providerMatchId: fixture.snapshot.externalId, kickoffAt: new Date(fixture.kickoffAt),
      homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, leagueName: fixture.league };
    return { fixture: oddsFixture, odds: apiPrematchOdds(rows, fixture, capturedAt) };
  }
}
