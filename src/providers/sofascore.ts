import type { AppConfig } from '../config.js';
import { supportedCompetitionIds, type MatchStatus, type NormalizedMatch } from '../domain/types.js';
import type { Logger } from '../logger.js';
import { check, statusFromError } from '../qualification/helpers.js';
import { providerCapabilities, type ProviderQualification, type QualifiableProvider } from '../qualification/types.js';
import { ResilientHttpClient } from './http-client.js';
import type { FootballDataProvider, FixtureQuery } from './provider.js';

type SofaTeam = {
  id: number;
  name: string;
  shortName?: string;
  country?: { name?: string };
};

type SofaEvent = {
  id: number;
  startTimestamp: number;
  status?: { type?: string; description?: string };
  tournament?: {
    name?: string;
    uniqueTournament?: { id?: number; name?: string };
    category?: { name?: string; country?: { name?: string } };
  };
  homeTeam: SofaTeam;
  awayTeam: SofaTeam;
  homeScore?: { current?: number };
  awayScore?: { current?: number };
  roundInfo?: { round?: number; name?: string };
  season?: { name?: string };
};

type ScheduledResponse = { events?: SofaEvent[] };
type StatisticsResponse = {
  statistics?: Array<{
    period?: string;
    groups?: Array<{
      statisticsItems?: Array<{
        name?: string;
        home?: string | number | null;
        away?: string | number | null;
      }>;
    }>;
  }>;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function matchStatus(type?: string): MatchStatus {
  if (type === 'notstarted') return 'scheduled';
  if (type === 'inprogress') return 'live';
  if (type === 'finished') return 'finished';
  if (type === 'postponed') return 'postponed';
  if (type === 'canceled' || type === 'cancelled') return 'cancelled';
  return 'unknown';
}

function statKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export class SofascoreProvider implements FootballDataProvider, QualifiableProvider {
  readonly name = 'sofascore';
  private readonly http: ResilientHttpClient;

  constructor(config: AppConfig, logger: Logger) {
    this.http = new ResilientHttpClient({
      baseUrl: config.SOFASCORE_BASE_URL.replace(/\/$/, ''),
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
      requestsPerSecond: config.PROVIDER_REQUESTS_PER_SECOND,
      maxRetries: config.PROVIDER_MAX_RETRIES,
      logger,
    });
  }

  async getFixtures(query: FixtureQuery): Promise<NormalizedMatch[]> {
    const fetchedAt = new Date();
    const payload = await this.http.getJson<ScheduledResponse>(`/sport/football/scheduled-events/${isoDate(query.date)}`);
    return (payload.events ?? [])
      .filter((event) => supportedCompetitionIds.has(String(event.tournament?.uniqueTournament?.id ?? '')))
      .map((event) => this.normalizeEvent(event, fetchedAt));
  }

  private normalizeEvent(event: SofaEvent, fetchedAt: Date): NormalizedMatch {
    const uniqueTournament = event.tournament?.uniqueTournament;
    const leagueExternalId = String(uniqueTournament?.id);
    const country = event.tournament?.category?.country?.name ?? event.tournament?.category?.name ?? null;
    const team = (value: SofaTeam) => ({
      providerExternalId: String(value.id),
      name: value.name,
      shortName: value.shortName ?? null,
      country: value.country?.name ?? null,
      logoUrl: `https://api.sofascore.com/api/v1/team/${value.id}/image`,
      sourceUpdatedAt: fetchedAt,
      raw: value,
    });
    return {
      providerExternalId: String(event.id),
      league: {
        providerExternalId: leagueExternalId,
        name: uniqueTournament?.name ?? event.tournament?.name ?? 'Unknown league',
        country,
        logoUrl: `https://api.sofascore.com/api/v1/unique-tournament/${leagueExternalId}/image`,
        sourceUpdatedAt: fetchedAt,
        raw: event.tournament,
      },
      homeTeam: team(event.homeTeam),
      awayTeam: team(event.awayTeam),
      kickoffAt: new Date(event.startTimestamp * 1000),
      status: matchStatus(event.status?.type),
      round: event.roundInfo?.name ?? (event.roundInfo?.round != null ? String(event.roundInfo.round) : null),
      season: event.season?.name ?? null,
      homeScore: event.homeScore?.current ?? null,
      awayScore: event.awayScore?.current ?? null,
      sourceUpdatedAt: fetchedAt,
      raw: event,
    };
  }

  async getMatchStatistics(matchProviderExternalId: string) {
    const fetchedAt = new Date();
    const payload = await this.http.getJson<StatisticsResponse>(`/event/${matchProviderExternalId}/statistics`);
    const statistics = (payload.statistics ?? []).flatMap((period) =>
      (period.groups ?? []).flatMap((group) =>
        (group.statisticsItems ?? [])
          .filter((item): item is typeof item & { name: string } => Boolean(item.name))
          .map((item) => ({
            key: statKey(item.name),
            label: item.name,
            period: period.period ?? 'ALL',
            homeValue: item.home ?? null,
            awayValue: item.away ?? null,
          })),
      ),
    );
    return { matchProviderExternalId, statistics, sourceUpdatedAt: fetchedAt, raw: payload };
  }

  async healthCheck() {
    const startedAt = Date.now();
    try {
      await this.http.getJson<ScheduledResponse>(`/sport/football/scheduled-events/${isoDate(new Date())}`);
      return { provider: this.name, ok: true, checkedAt: new Date(), latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        provider: this.name,
        ok: false,
        checkedAt: new Date(),
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async qualify(): Promise<ProviderQualification> {
    const source = 'Sofascore public web JSON endpoints';
    const started = Date.now();
    try {
      const fixtures = await this.getFixtures({ date: new Date() });
      const completed = fixtures.find((match) => match.status === 'finished');
      const stats = completed ? await this.getMatchStatistics(completed.providerExternalId) : null;
      const keys = new Set(stats?.statistics.map((item) => item.key) ?? []);
      const baseSupported = new Set(['FIXTURES', 'TEAM_INFO', 'LEAGUE_INFO']);
      const metricKeys = new Map<string, string[]>([
        ['CORNERS', ['corner_kicks', 'corners']], ['YELLOW_CARDS', ['yellow_cards']], ['RED_CARDS', ['red_cards']],
        ['FOULS', ['fouls']], ['SHOTS', ['total_shots']], ['SHOTS_ON_TARGET', ['shots_on_target']],
        ['POSSESSION', ['ball_possession']], ['XG', ['expected_goals']],
      ]);
      const latencyMs = Date.now() - started;
      const checks = providerCapabilities.map((capability) => {
        const ok = baseSupported.has(capability) || (capability === 'MATCH_RESULT' && Boolean(completed)) ||
          (metricKeys.get(capability)?.some((key) => keys.has(key)) ?? false);
        return check(capability, ok ? 'SUPPORTED' : 'UNAVAILABLE', source, { httpStatus: 200, latencyMs,
          sampleCount: ok ? 1 : 0, parseSuccess: ok, notes: ok ? null : 'Canlı örnekte doğrulanmadı' });
      });
      return { provider: this.name, connection: 'SUPPORTED', checks };
    } catch (error) {
      const httpStatus = statusFromError(error);
      const result = httpStatus === 403 || httpStatus === 429 ? 'BLOCKED' : 'UNAVAILABLE';
      return { provider: this.name, connection: result, checks: providerCapabilities.map((capability) =>
        check(capability, result, source, { httpStatus, latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error) })) };
    }
  }
}
