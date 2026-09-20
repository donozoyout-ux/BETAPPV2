import type { DatabasePool } from '../db/pool.js';
import type { OddsSnapshot } from '../odds-analysis/types.js';
import { buildOddsRoute } from './features.js';
import { buildOddsIntelligence } from './engine.js';
import { oddsNeighborConfig } from './config.js';
import { chronologicalNeighborBacktest } from './backtest.js';
import type { HistoricalNeighborInput, MatchOutcomeData, OddsIntelligence, OddsRoute, SearchMode } from './types.js';

type Row = Record<string, unknown>;
function snapshot(row: Record<string, unknown>): OddsSnapshot { return { matchId: String(row.match_id), provider: String(row.provider), marketType: String(row.market_type), marketName: String(row.market_name), line: row.line == null ? null : Number(row.line), selection: String(row.selection), oddsDecimal: Number(row.odds_decimal), capturedAt: new Date(String(row.captured_at)) }; }
function outcome(row: Row): MatchOutcomeData { return { matchId: String(row.match_id), competitionId: String(row.competition_id), kickoffAt: new Date(String(row.kickoff_at)), league: String(row.league), homeTeam: String(row.home_team), awayTeam: String(row.away_team),
  homeScore: row.home_score == null ? null : Number(row.home_score), awayScore: row.away_score == null ? null : Number(row.away_score), firstHalfHomeScore: null, firstHalfAwayScore: null,
  homeCorners: row.home_corners == null ? null : Number(row.home_corners), awayCorners: row.away_corners == null ? null : Number(row.away_corners),
  homeYellowCards: row.home_yellow_cards == null ? null : Number(row.home_yellow_cards), awayYellowCards: row.away_yellow_cards == null ? null : Number(row.away_yellow_cards),
  homeRedCards: row.home_red_cards == null ? null : Number(row.home_red_cards), awayRedCards: row.away_red_cards == null ? null : Number(row.away_red_cards) }; }
function identity(route: OddsRoute) { return `${route.marketType}|${route.marketName}|${route.line ?? 'null'}|${route.selection}`; }
function routeCandidates(data: MatchOutcomeData, snapshots: OddsSnapshot[], generatedAt: Date): OddsRoute[] {
  const markets = new Map<string, OddsSnapshot[]>();
  for (const item of snapshots) { const key = `${item.marketType}|${item.marketName}|${item.line ?? 'null'}`; markets.set(key, [...(markets.get(key) ?? []), item]); }
  const routes: OddsRoute[] = [];
  for (const rows of markets.values()) for (const selection of new Set(rows.map((item) => item.selection))) {
    const first = rows[0]!; const route = buildOddsRoute(data.matchId, data.kickoffAt, snapshots, first.marketType, first.marketName, first.line, selection, generatedAt);
    if (route) routes.push(route);
  }
  return routes;
}
function selectPrimary(routes: OddsRoute[]): OddsRoute | null {
  return [...routes].sort((a, b) => ({ STRONG: 3, MODERATE: 2, WEAK: 1 }[b.strength] - { STRONG: 3, MODERATE: 2, WEAK: 1 }[a.strength])
    || b.genuineObservations - a.genuineObservations || Math.abs(b.totalMovementPp) - Math.abs(a.totalMovementPp)
    || identity(a).localeCompare(identity(b)))[0] ?? null;
}

/** Batched DB gateway. It never reads Prediction V1 tables or writes any journal data. */
export class OddsIntelligenceRepository {
  constructor(private readonly pool: DatabasePool) {}

  private async targets(matchId: string | null, limit: number, now: Date): Promise<Array<{ data: MatchOutcomeData; snapshots: OddsSnapshot[] }>> {
    const result = await this.pool.query(`SELECT m.id match_id,m.league_id competition_id,m.kickoff_at,l.name league,ht.name home_team,at.name away_team,
      m.home_score,m.away_score,NULL::numeric home_corners,NULL::numeric away_corners,NULL::numeric home_yellow_cards,NULL::numeric away_yellow_cards,
      NULL::numeric home_red_cards,NULL::numeric away_red_cards,
      COALESCE(jsonb_agg(jsonb_build_object('match_id',os.match_id,'provider',os.provider,'market_type',os.market_type,'market_name',os.market_name,
        'line',os.line,'selection',os.selection,'odds_decimal',os.odds_decimal,'captured_at',os.captured_at) ORDER BY os.captured_at,os.id)
        FILTER(WHERE os.id IS NOT NULL),'[]'::jsonb) snapshots
      FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      JOIN odds_snapshots os ON os.match_id=m.id
      WHERE ($1::uuid IS NULL OR m.id=$1) AND m.status='scheduled' AND m.kickoff_at>$2
      GROUP BY m.id,l.name,ht.name,at.name ORDER BY m.kickoff_at LIMIT $3`, [matchId, now, limit]);
    return result.rows.map((row) => ({ data: outcome(row), snapshots: (row.snapshots as Row[]).map(snapshot) }));
  }

  private async historicalFor(targets: Array<{ data: MatchOutcomeData; route: OddsRoute }>) {
    if (!targets.length) return new Map<string, HistoricalNeighborInput[]>();
    const result = await this.pool.query(`WITH requested AS (
      SELECT * FROM unnest($1::uuid[],$2::timestamptz[],$3::text[],$4::text[],$5::numeric[],$6::text[])
      AS r(target_id,target_kickoff,market_type,market_name,line,selection)
    ) SELECT r.target_id,m.id match_id,m.league_id competition_id,m.kickoff_at,l.name league,ht.name home_team,at.name away_team,m.home_score,m.away_score,
      h.home_corners,h.away_corners,h.home_yellow_cards,h.away_yellow_cards,h.home_red_cards,h.away_red_cards,
      COALESCE(jsonb_agg(jsonb_build_object('match_id',os.match_id,'provider',os.provider,'market_type',os.market_type,'market_name',os.market_name,
        'line',os.line,'selection',os.selection,'odds_decimal',os.odds_decimal,'captured_at',os.captured_at) ORDER BY os.captured_at,os.id),'[]'::jsonb) snapshots
      FROM requested r JOIN matches m ON m.status='finished' AND m.kickoff_at<r.target_kickoff
      JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      LEFT JOIN historical_match_stats h ON h.match_id=m.id
      JOIN odds_snapshots os ON os.match_id=m.id AND os.market_type=r.market_type AND os.market_name=r.market_name AND os.line IS NOT DISTINCT FROM r.line
      WHERE EXISTS(SELECT 1 FROM odds_snapshots evidence WHERE evidence.match_id=m.id AND evidence.market_type=r.market_type
        AND evidence.market_name=r.market_name AND evidence.line IS NOT DISTINCT FROM r.line AND evidence.selection=r.selection
        AND evidence.captured_at<m.kickoff_at)
      GROUP BY r.target_id,m.id,l.name,ht.name,at.name,h.home_corners,h.away_corners,h.home_yellow_cards,h.away_yellow_cards,h.home_red_cards,h.away_red_cards`,
    [targets.map((item) => item.data.matchId), targets.map((item) => item.data.kickoffAt), targets.map((item) => item.route.marketType),
      targets.map((item) => item.route.marketName), targets.map((item) => item.route.line), targets.map((item) => item.route.selection)]);
    const grouped = new Map<string, HistoricalNeighborInput[]>();
    for (const row of result.rows) {
      const data = outcome(row); const rows = (row.snapshots as Row[]).map(snapshot);
      const route = buildOddsRoute(data.matchId, data.kickoffAt, rows, String(row.market_type ?? targets.find((item) => item.data.matchId === String(row.target_id))!.route.marketType),
        String(row.market_name ?? targets.find((item) => item.data.matchId === String(row.target_id))!.route.marketName),
        row.line == null ? targets.find((item) => item.data.matchId === String(row.target_id))!.route.line : Number(row.line),
        targets.find((item) => item.data.matchId === String(row.target_id))!.route.selection, data.kickoffAt);
      if (route) grouped.set(String(row.target_id), [...(grouped.get(String(row.target_id)) ?? []), { ...data, route }]);
    }
    return grouped;
  }

  async upcoming(limit = 20, now = new Date(), mode: SearchMode = 'CLOSEST_NEIGHBORS'): Promise<OddsIntelligence[]> {
    const raw = await this.targets(null, Math.max(1, Math.min(limit, 100)), now);
    const prepared = raw.map((item) => ({ data: item.data, route: selectPrimary(routeCandidates(item.data, item.snapshots, now)) })).filter((item): item is { data: MatchOutcomeData; route: OddsRoute } => item.route != null);
    const history = await this.historicalFor(prepared);
    return prepared.map((item) => buildOddsIntelligence({ ...item.data, route: item.route }, history.get(item.data.matchId) ?? [],
      { mode, limit: mode === 'ODDS_BAND' ? oddsNeighborConfig.bandLimit : oddsNeighborConfig.closestLimit }, now));
  }

  async byMatch(matchId: string, now = new Date()): Promise<OddsIntelligence | null> {
    const raw = await this.targets(matchId, 1, now); const item = raw[0]; if (!item) return null;
    const route = selectPrimary(routeCandidates(item.data, item.snapshots, now)); if (!route) return null;
    const history = await this.historicalFor([{ data: item.data, route }]);
    return buildOddsIntelligence({ ...item.data, route }, history.get(item.data.matchId) ?? [],
      { mode: 'CLOSEST_NEIGHBORS', limit: oddsNeighborConfig.closestLimit }, now);
  }

  async historyAudit(limit = 5000) {
    const safeLimit = Math.max(1, Math.min(50_000, Math.trunc(limit)));
    const summary = await this.pool.query(`SELECT
      (SELECT count(*)::integer FROM matches WHERE status='finished') total_finished_matches,
      (SELECT count(DISTINCT m.id)::integer FROM matches m JOIN odds_snapshots os ON os.match_id=m.id
        WHERE m.status='finished' AND os.captured_at<m.kickoff_at) matches_with_pre_kickoff_odds,
      (SELECT count(*)::bigint FROM matches m JOIN odds_snapshots os ON os.match_id=m.id
        WHERE m.status='finished' AND os.captured_at<m.kickoff_at) pre_kickoff_snapshots,
      (SELECT count(*)::bigint FROM matches m JOIN odds_snapshots os ON os.match_id=m.id
        WHERE m.status='finished' AND os.captured_at>=m.kickoff_at) excluded_post_kickoff_snapshots`);

    const result = await this.pool.query(`SELECT m.id match_id,m.league_id competition_id,m.kickoff_at,m.season,l.name league,
      ht.name home_team,at.name away_team,m.home_score,m.away_score,
      NULL::numeric home_corners,NULL::numeric away_corners,NULL::numeric home_yellow_cards,NULL::numeric away_yellow_cards,
      NULL::numeric home_red_cards,NULL::numeric away_red_cards,
      COALESCE(jsonb_agg(jsonb_build_object('match_id',os.match_id,'provider',os.provider,'market_type',os.market_type,
        'market_name',os.market_name,'line',os.line,'selection',os.selection,'odds_decimal',os.odds_decimal,
        'captured_at',os.captured_at) ORDER BY os.captured_at,os.id),'[]'::jsonb) snapshots
      FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      JOIN odds_snapshots os ON os.match_id=m.id AND os.captured_at<m.kickoff_at
      WHERE m.status='finished'
      GROUP BY m.id,l.name,ht.name,at.name
      ORDER BY m.kickoff_at,m.id
      LIMIT $1`, [safeLimit]);

    const marketStats = new Map<string, {
      marketType: string; marketName: string; line: number | null; selection: string;
      matches: Set<string>; routes: number; movementReadyRoutes: number; observationSum: number; bookmakerSum: number;
      strong: number; moderate: number; weak: number;
    }>();
    const competitionSeasons = new Map<string, {
      league: string; season: string; matches: number; matchesWithRoute: number; matchesWithMovementReadyRoute: number;
    }>();
    const providers = new Set<string>();
    let routes = 0;
    let movementReadyRoutes = 0;
    let matchesWithRoute = 0;
    let matchesWithMovementReadyRoute = 0;
    let earliestKickoffMs: number | null = null;
    let latestKickoffMs: number | null = null;

    for (const row of result.rows) {
      const data = outcome(row);
      const snapshots = (row.snapshots as Row[]).map(snapshot);
      for (const item of snapshots) providers.add(item.provider);
      const built = routeCandidates(data, snapshots, data.kickoffAt);
      const hasRoute = built.length > 0;
      const hasMovementRoute = built.some((route) => route.genuineObservations >= 2);
      if (hasRoute) matchesWithRoute += 1;
      if (hasMovementRoute) matchesWithMovementReadyRoute += 1;
      routes += built.length;
      movementReadyRoutes += built.filter((route) => route.genuineObservations >= 2).length;
      const kickoffMs = data.kickoffAt.getTime();
      earliestKickoffMs = earliestKickoffMs == null ? kickoffMs : Math.min(earliestKickoffMs, kickoffMs);
      latestKickoffMs = latestKickoffMs == null ? kickoffMs : Math.max(latestKickoffMs, kickoffMs);

      const season = String(row.season ?? 'UNKNOWN');
      const competitionKey = `${data.league}|${season}`;
      const competition = competitionSeasons.get(competitionKey) ?? {
        league: data.league, season, matches: 0, matchesWithRoute: 0, matchesWithMovementReadyRoute: 0,
      };
      competition.matches += 1;
      if (hasRoute) competition.matchesWithRoute += 1;
      if (hasMovementRoute) competition.matchesWithMovementReadyRoute += 1;
      competitionSeasons.set(competitionKey, competition);

      for (const route of built) {
        const key = identity(route);
        const item = marketStats.get(key) ?? {
          marketType: route.marketType, marketName: route.marketName, line: route.line, selection: route.selection,
          matches: new Set<string>(), routes: 0, movementReadyRoutes: 0, observationSum: 0, bookmakerSum: 0,
          strong: 0, moderate: 0, weak: 0,
        };
        item.matches.add(data.matchId);
        item.routes += 1;
        if (route.genuineObservations >= 2) item.movementReadyRoutes += 1;
        item.observationSum += route.genuineObservations;
        item.bookmakerSum += route.bookmakers.length;
        if (route.strength === 'STRONG') item.strong += 1;
        else if (route.strength === 'MODERATE') item.moderate += 1;
        else item.weak += 1;
        marketStats.set(key, item);
      }
    }

    const summaryRow = summary.rows[0] ?? {};
    const totalFinishedMatches = Number(summaryRow.total_finished_matches ?? 0);
    const matchesWithPreKickoffOdds = Number(summaryRow.matches_with_pre_kickoff_odds ?? 0);
    return {
      generatedAt: new Date(),
      scanLimit: safeLimit,
      scannedMatches: result.rows.length,
      truncated: matchesWithPreKickoffOdds > result.rows.length,
      archive: {
        totalFinishedMatches,
        matchesWithPreKickoffOdds,
        finishedMatchOddsCoverage: totalFinishedMatches ? matchesWithPreKickoffOdds / totalFinishedMatches : 0,
        preKickoffSnapshots: Number(summaryRow.pre_kickoff_snapshots ?? 0),
        excludedPostKickoffSnapshots: Number(summaryRow.excluded_post_kickoff_snapshots ?? 0),
        providers: [...providers].sort(),
        earliestKickoff: earliestKickoffMs == null ? null : new Date(earliestKickoffMs),
        latestKickoff: latestKickoffMs == null ? null : new Date(latestKickoffMs),
      },
      routeReadiness: {
        matchesWithRoute,
        matchesWithMovementReadyRoute,
        routes,
        movementReadyRoutes,
        scannedMatchRouteCoverage: result.rows.length ? matchesWithRoute / result.rows.length : 0,
        scannedMatchMovementCoverage: result.rows.length ? matchesWithMovementReadyRoute / result.rows.length : 0,
      },
      markets: [...marketStats.values()].map((item) => ({
        marketType: item.marketType,
        marketName: item.marketName,
        line: item.line,
        selection: item.selection,
        matches: item.matches.size,
        routes: item.routes,
        movementReadyRoutes: item.movementReadyRoutes,
        averageObservations: item.routes ? item.observationSum / item.routes : 0,
        averageBookmakers: item.routes ? item.bookmakerSum / item.routes : 0,
        strength: { strong: item.strong, moderate: item.moderate, weak: item.weak },
      })).sort((a, b) => b.matches - a.matches || a.marketType.localeCompare(b.marketType)
        || String(a.line ?? '').localeCompare(String(b.line ?? '')) || a.selection.localeCompare(b.selection)),
      competitionSeasons: [...competitionSeasons.values()]
        .sort((a, b) => a.league.localeCompare(b.league) || a.season.localeCompare(b.season)),
    };
  }

  async backtest() {
    const result = await this.pool.query(`SELECT m.id match_id,m.league_id competition_id,m.kickoff_at,l.name league,ht.name home_team,at.name away_team,
      m.home_score,m.away_score,h.home_corners,h.away_corners,h.home_yellow_cards,h.away_yellow_cards,h.home_red_cards,h.away_red_cards,
      COALESCE(jsonb_agg(jsonb_build_object('match_id',os.match_id,'provider',os.provider,'market_type',os.market_type,'market_name',os.market_name,
        'line',os.line,'selection',os.selection,'odds_decimal',os.odds_decimal,'captured_at',os.captured_at) ORDER BY os.captured_at,os.id),'[]'::jsonb) snapshots
      FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      LEFT JOIN historical_match_stats h ON h.match_id=m.id JOIN odds_snapshots os ON os.match_id=m.id
      WHERE m.status='finished' GROUP BY m.id,l.name,ht.name,at.name,h.home_corners,h.away_corners,h.home_yellow_cards,h.away_yellow_cards,h.home_red_cards,h.away_red_cards
      ORDER BY m.kickoff_at,m.id`);
    const records = result.rows.map((row) => {
      const data = outcome(row); const route = selectPrimary(routeCandidates(data, (row.snapshots as Row[]).map(snapshot), data.kickoffAt));
      return route ? { ...data, route } : null;
    }).filter((item): item is MatchOutcomeData & { route: OddsRoute } => item != null);
    return chronologicalNeighborBacktest(records);
  }
}
