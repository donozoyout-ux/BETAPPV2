import type { AppConfig } from '../config.js';
import type { MatchStatistics, MatchStatus, NormalizedMatch } from '../domain/types.js';
import type { Logger } from '../logger.js';
import { check, statusFromError } from '../qualification/helpers.js';
import { providerCapabilities, type CapabilityCheck, type ProviderQualification, type QualifiableProvider } from '../qualification/types.js';
import { ResilientHttpClient } from './http-client.js';
import type { FixtureQuery, FootballDataProvider } from './provider.js';

export const fotmobCompetitions = [
  { id: 47, name: 'Premier League', key: 'PremierLeague' }, { id: 87, name: 'La Liga', key: 'LaLiga' },
  { id: 54, name: 'Bundesliga', key: 'Bundesliga' }, { id: 55, name: 'Serie A', key: 'SerieA' },
  { id: 53, name: 'Ligue 1', key: 'Ligue1' }, { id: 71, name: 'Süper Lig', key: 'SuperLig' },
  { id: 42, name: 'UEFA Champions League', key: 'ChampionsLeague' },
  { id: 73, name: 'UEFA Europa League', key: 'EuropaLeague' },
  { id: 10216, name: 'UEFA Conference League', key: 'ConferenceLeague' },
  { id: 268, name: 'Brasileirão Série A', key: 'BrasileiraoSerieA' },
  { id: 57, name: 'Eredivisie', key: 'Eredivisie' },
  { id: 40, name: 'Belgian Pro League', key: 'BelgianProLeague' },
  { id: 46, name: 'Danish Superliga', key: 'DanishSuperliga' },
  { id: 67, name: 'Allsvenskan', key: 'Allsvenskan' },
  { id: 135, name: 'Greek Super League', key: 'GreekSuperLeague' },
  { id: 77, name: 'FIFA World Cup', key: 'WorldCup' },
  { id: 50, name: 'EURO', key: 'EURO' },
  { id: 9806, name: 'UEFA Nations League A', key: 'UefaNationsLeagueA' },
  { id: 9807, name: 'UEFA Nations League B', key: 'UefaNationsLeagueB' },
  { id: 9808, name: 'UEFA Nations League C', key: 'UefaNationsLeagueC' },
  { id: 9809, name: 'UEFA Nations League D', key: 'UefaNationsLeagueD' },
  { id: 10195, name: 'World Cup Qualification UEFA', key: 'WorldCupQualificationUEFA' },
  { id: 10607, name: 'EURO Qualification', key: 'EUROQualification' },
  { id: 44, name: 'Copa America', key: 'CopaAmerica' },
  { id: 10199, name: 'World Cup Qualification CONMEBOL', key: 'WorldCupQualificationCONMEBOL' },
  { id: 114, name: 'Friendlies', key: 'InternationalFriendlies' },
] as const;
export const fotmobLeagueIds = fotmobCompetitions.map((competition) => competition.id);

type FotMobMatch = {
  id: number | string; leagueId?: number; time?: string; round?: string;
  home: { id: number | string; name: string; score?: number };
  away: { id: number | string; name: string; score?: number };
  status: { utcTime: string; started?: boolean; finished?: boolean; cancelled?: boolean; scoreStr?: string };
};
type FotMobLeague = { id: number; primaryId: number; name: string; ccode?: string; matches?: FotMobMatch[] };
type MatchesPayload = { leagues?: FotMobLeague[] };
type LeaguePayload = { details?: { name?: string; country?: string; selectedSeason?: string }; allAvailableSeasons?: string[];
  fixtures?: { allMatches?: FotMobMatch[] } };
type StatItem = { title?: string; key?: string; stats?: Array<string | number | null> };
type DetailsPayload = {
  general?: Record<string, unknown> & { parentLeagueId?: number; leagueId?: number; leagueName?: string; matchRound?: string; matchTimeUTC?: string };
  header?: { teams?: Array<{ id: number; name: string; score?: number; imageUrl?: string }>; status?: { finished?: boolean; started?: boolean; cancelled?: boolean } };
  content?: {
    stats?: { Periods?: Record<string, { stats?: Array<{ stats?: StatItem[] }> }> };
    lineup?: Record<string, unknown>;
    h2h?: Record<string, unknown>;
    matchFacts?: { infoBox?: Record<string, unknown>; events?: unknown };
  };
};

function yyyymmdd(date: Date) { return date.toISOString().slice(0, 10).replaceAll('-', ''); }
function slug(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function status(value: FotMobMatch['status']): MatchStatus {
  if (value.cancelled) return 'cancelled';
  if (value.finished) return 'finished';
  if (value.started) return 'live';
  return 'scheduled';
}

export class FotMobProvider implements FootballDataProvider, QualifiableProvider {
  readonly name = 'fotmob';
  private readonly http: ResilientHttpClient;
  private readonly baseUrl: string;
  private readonly supportedLeagueIds: Set<number>;
  private readonly detailsCache = new Map<string, { expiresAt: number; fetchedAt: Date; payload: DetailsPayload }>();

  constructor(config: AppConfig, logger: Logger) {
    this.baseUrl = config.FOTMOB_BASE_URL.replace(/\/$/, '');
    this.supportedLeagueIds = new Set(fotmobCompetitions
      .filter((competition) => config.SUPPORTED_COMPETITIONS.includes(competition.key)).map((competition) => competition.id));
    this.http = new ResilientHttpClient({ baseUrl: this.baseUrl, timeoutMs: config.PROVIDER_TIMEOUT_MS,
      requestsPerSecond: config.PROVIDER_REQUESTS_PER_SECOND, maxRetries: config.PROVIDER_MAX_RETRIES, logger });
  }

  async getFixtures(query: FixtureQuery): Promise<NormalizedMatch[]> {
    const fetchedAt = new Date();
    const payload = await this.http.getJson<MatchesPayload>(`/matches?date=${yyyymmdd(query.date)}&timezone=Europe%2FIstanbul&ccode3=TUR`);
    return (payload.leagues ?? []).filter((league) => this.supportedLeagueIds.has(league.primaryId)).flatMap((league) =>
      (league.matches ?? []).map((match) => this.normalizeMatch(league, match, fetchedAt)));
  }

  private normalizeMatch(league: FotMobLeague, match: FotMobMatch, fetchedAt: Date): NormalizedMatch {
    const configuredCompetition = fotmobCompetitions.find((competition) => competition.id === league.primaryId);
    const canonicalLeagueName = configuredCompetition?.name ?? league.name;
    const team = (value: FotMobMatch['home']) => ({ providerExternalId: String(value.id), name: value.name,
      shortName: null, country: null, logoUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${value.id}_small.png`,
      sourceUpdatedAt: fetchedAt, raw: { id: value.id, name: value.name } });
    const score = match.status.scoreStr?.split(/\s*-\s*/).map(Number) ?? [];
    return {
      providerExternalId: String(match.id),
      league: { providerExternalId: String(league.primaryId), name: canonicalLeagueName, country: league.ccode ?? null,
        logoUrl: `https://images.fotmob.com/image_resources/logo/leaguelogo/${league.primaryId}.png`, sourceUpdatedAt: fetchedAt,
        raw: { id: league.id, primaryId: league.primaryId, name: league.name, ccode: league.ccode } },
      homeTeam: team(match.home), awayTeam: team(match.away), kickoffAt: new Date(match.status.utcTime),
      status: status(match.status), round: match.round ?? null, season: null,
      homeScore: match.home.score ?? (Number.isFinite(score[0]) ? score[0]! : null),
      awayScore: match.away.score ?? (Number.isFinite(score[1]) ? score[1]! : null), sourceUpdatedAt: fetchedAt,
      raw: match,
    };
  }

  async getAvailableSeasons(leagueId: number): Promise<string[]> {
    const payload = await this.http.getJson<LeaguePayload>(`/leagues?id=${leagueId}&ccode3=TUR`);
    return payload.allAvailableSeasons ?? [];
  }

  async getHistoricalFixtures(leagueId: number, season: string): Promise<NormalizedMatch[]> {
    return (await this.getSeasonFixtures(leagueId, season)).filter(match => match.status === 'finished');
  }

  async getSeasonFixtures(leagueId: number, season: string): Promise<NormalizedMatch[]> {
    if (!this.supportedLeagueIds.has(leagueId)) throw new Error(`Unsupported FotMob league: ${leagueId}`);
    const fetchedAt = new Date();
    const payload = await this.http.getJson<LeaguePayload>(`/leagues?id=${leagueId}&ccode3=TUR&season=${encodeURIComponent(season)}`);
    const league: FotMobLeague = { id: leagueId, primaryId: leagueId, name: payload.details?.name ?? `League ${leagueId}`,
      ...(payload.details?.country ? { ccode: payload.details.country } : {}), matches: payload.fixtures?.allMatches ?? [] };
    return (league.matches ?? []).map((match) => ({
      ...this.normalizeMatch(league, match, fetchedAt), season,
    }));
  }

  async details(matchId: string): Promise<DetailsPayload> {
    const cached = this.detailsCache.get(matchId);
    if (cached && cached.expiresAt > Date.now()) return cached.payload;
    const payload = await this.http.getJson<DetailsPayload>(`/matchDetails?matchId=${encodeURIComponent(matchId)}`);
    // Qualification and a backfill can ask for the same detail payload more than once.
    // Keep it process-local and short-lived so we reduce duplicate traffic without
    // treating cached data as persisted historical evidence.
    this.detailsCache.set(matchId, { payload, fetchedAt: new Date(), expiresAt: Date.now() + (payload.header?.status?.finished ? 5 * 60_000 : 30_000) });
    return payload;
  }

  async getMatchStatistics(matchProviderExternalId: string): Promise<MatchStatistics> {
    const payload = await this.details(matchProviderExternalId);
    const seen = new Set<string>();
    const items = payload.content?.stats?.Periods?.All?.stats?.flatMap((group) => group.stats ?? []) ?? [];
    const statistics = items.flatMap((item) => {
      if (!item.title || !item.stats || item.stats.length < 2) return [];
      const key = slug(item.title);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, label: item.title, period: 'ALL', homeValue: item.stats[0] ?? null, awayValue: item.stats[1] ?? null }];
    });
    return { matchProviderExternalId, statistics, sourceUpdatedAt: this.detailsCache.get(matchProviderExternalId)!.fetchedAt, raw: {
      general: payload.general, header: payload.header, stats: payload.content?.stats,
      lineup: payload.content?.lineup, h2h: payload.content?.h2h, infoBox: payload.content?.matchFacts?.infoBox,
    } };
  }

  async healthCheck() {
    const startedAt = Date.now();
    try {
      await this.getFixtures({ date: new Date() });
      return { provider: this.name, ok: true, checkedAt: new Date(), latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { provider: this.name, ok: false, checkedAt: new Date(), latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error) };
    }
  }

  consumeRetryCount() { return this.http.consumeRetryCount(); }

  async qualify(): Promise<ProviderQualification> {
    const source = `${this.baseUrl}/matches + /matchDetails`;
    const started = Date.now();
    try {
      const now = new Date();
      let upcoming: NormalizedMatch | undefined;
      let completed: NormalizedMatch | undefined;
      for (let offset = 0; offset <= 14 && (!upcoming || !completed); offset += 1) {
        for (const direction of offset === 0 ? [0] : [-offset, offset]) {
          const date = new Date(now); date.setUTCDate(date.getUTCDate() + direction);
          const fixtures = await this.getFixtures({ date });
          upcoming ??= fixtures.find((match) => match.status === 'scheduled');
          completed ??= fixtures.find((match) => match.status === 'finished');
          if (upcoming && completed) break;
        }
      }
      if (!upcoming || !completed) throw new Error('Upcoming ve completed örneklerin ikisi birden bulunamadı');
      const details = await this.details(completed.providerExternalId);
      const stats = await this.getMatchStatistics(completed.providerExternalId);
      const keys = new Set(stats.statistics.map((item) => item.key));
      const latencyMs = Date.now() - started;
      const supported = (capability: CapabilityCheck['capability'], ok: boolean, notes?: string) =>
        check(capability, ok ? 'SUPPORTED' : 'UNAVAILABLE', source, { httpStatus: 200, latencyMs,
          sampleCount: ok ? 1 : 0, parseSuccess: ok, notes: notes ?? null });
      const byMetric = new Map<string, string[]>([
        ['GOALS', ['goals']], ['CORNERS', ['corners']], ['YELLOW_CARDS', ['yellow_cards']], ['RED_CARDS', ['red_cards']],
        ['FOULS', ['fouls_committed']], ['SHOTS', ['total_shots']], ['SHOTS_ON_TARGET', ['shots_on_target']],
        ['POSSESSION', ['ball_possession']], ['XG', ['expected_goals', 'expected_goals_xg']],
      ]);
      const checks = providerCapabilities.map((capability) => {
        if (['FIXTURES','MATCH_RESULT','TEAM_INFO','LEAGUE_INFO','HISTORICAL_MATCHES','GOALS'].includes(capability)) return supported(capability, true);
        if (byMetric.has(capability)) return supported(capability, byMetric.get(capability)!.some((key) => keys.has(key)));
        if (capability === 'LINEUPS') return supported(capability, Boolean(details.content?.lineup));
        if (capability === 'H2H') return supported(capability, Boolean(details.content?.h2h));
        if (capability === 'REFEREE') return supported(capability, JSON.stringify(details.content?.matchFacts?.infoBox ?? {}).toLowerCase().includes('referee'));
        if (capability === 'INJURIES') return check(capability, 'PARTIAL', source, { httpStatus: 200, latencyMs, parseSuccess: Boolean(details.content?.lineup), notes: 'Lineup availability verisi mevcut; sakatlık nedeni her maçta garanti değil' });
        return check(capability, 'UNAVAILABLE', source, { httpStatus: 200, latencyMs, notes: 'Canlı örnek payloadında doğrulanmadı' });
      });
      return { provider: this.name, connection: 'SUPPORTED', checks };
    } catch (error) {
      const httpStatus = statusFromError(error);
      const result = httpStatus === 403 ? 'BLOCKED' : 'UNAVAILABLE';
      return { provider: this.name, connection: result, checks: providerCapabilities.map((capability) =>
        check(capability, result, source, { httpStatus, latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error) })) };
    }
  }
}
