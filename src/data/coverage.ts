import type { DatabasePool } from '../db/pool.js';
import { fotmobCompetitions } from '../providers/fotmob.js';
import { competitionKey, competitionKind } from '../matching/competition.js';
import type { ExpansionReport } from '../historical/competition-scope.js';
import { DATA_TARGET_V1, enrichCoverageTargets } from './coverage-target.js';
export function coverageRows(rows: Array<Record<string, unknown>>, configured: readonly string[]) {
  return fotmobCompetitions.filter(c => configured.includes(c.key)).map(c => {
    const matches = rows.filter(row => competitionKey(String(row.competition)) === competitionKey(c.name));
    const sum = (key: string) => matches.reduce((total,row) => total + Number(row[key] ?? 0), 0);
    const dates = (key: string) => matches.map(r => r[key]).filter(Boolean).map(d => new Date(String(d)).toISOString()).sort();
    return { competition: String(c.name), configKey: c.key, providerId: c.id, type: competitionKind(c.name),
      matches: sum('matches'), finishedMatches: sum('finished_matches'), matchesWithStats: sum('stats'),
      matchesWithOdds: sum('odds'), matchesWithThreeBookmakers: sum('odds_three'), oddsSnapshots: sum('odds_snapshots'),
      csvHistoricalOddsMatches: sum('csv_odds'), csvHistoricalThreeBookmakers: sum('csv_odds_three'),
      csvHistoricalOddsQuotes: sum('csv_odds_quotes'),
      csvStageMatches: sum('csv_stage_matches'), csvStageExamples: sum('csv_stage_examples'),
      csvStageResearchEligible: sum('csv_stage_research_eligible'),
      upcomingMatches7d: sum('upcoming_matches'), upcomingMatchesWithOdds7d: sum('upcoming_odds'),
      upcomingMatchesWithThreeBookmakers7d: sum('upcoming_odds_three'),
      matchesWithCorners: sum('corners'), predictionHistoricalExamples: sum('examples'),
      earliestMatch: dates('earliest')[0] ?? null, latestMatch: dates('latest').at(-1) ?? null };
  });
}
export class DataCoverageService {
  private cache: { expiresAt: number; value: Awaited<ReturnType<DataCoverageService['load']>> } | undefined;
  private pending: Promise<Awaited<ReturnType<DataCoverageService['load']>>> | undefined;
  constructor(private readonly pool: DatabasePool, private readonly configured: readonly string[]) {}
  async get() {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try { const value = await this.pending; this.cache = { value, expiresAt: Date.now()+300_000 }; return value; }
    finally { this.pending = undefined; }
  }
  private async load() {
    // Aggregate each evidence table before joining to avoid cross-product overcounts.
    const result = await this.pool.query(`WITH stats AS (
      SELECT match_id,bool_or(home_value IS NOT NULL OR away_value IS NOT NULL) available,
        bool_or(period='ALL' AND stat_key IN('corners','corner_kicks') AND home_value IS NOT NULL AND away_value IS NOT NULL) corners
      FROM match_statistics GROUP BY match_id
    ), odds AS (
      SELECT o.match_id,count(*)::int snapshots,
        count(DISTINCT regexp_replace(lower(o.provider),'^[^:]+:',''))::int bookmakers
      FROM odds_snapshots o JOIN matches om ON om.id=o.match_id
      WHERE o.captured_at < om.kickoff_at AND o.odds_decimal > 1
      GROUP BY o.match_id
    ), csv_odds AS (
      SELECT match_id,count(*)::int quotes,count(DISTINCT lower(bookmaker))::int bookmakers
      FROM historical_market_odds WHERE pre_kickoff_verified=true GROUP BY match_id
    ), stage_examples AS (
      SELECT competition_id,count(DISTINCT match_id)::int matches,count(*)::int examples,
        count(*) FILTER(WHERE research_eligible)::int research_eligible
      FROM prediction_stage_historical_examples GROUP BY competition_id
    ), examples AS (SELECT competition_id,count(*)::int count FROM prediction_historical_examples GROUP BY competition_id)
    SELECT l.name competition,count(m.id)::int matches,
      count(m.id) FILTER(WHERE m.status='finished')::int finished_matches,
      count(m.id) FILTER(WHERE s.available OR h.home_corners IS NOT NULL OR h.away_corners IS NOT NULL
        OR h.home_shots IS NOT NULL OR h.away_shots IS NOT NULL OR h.home_possession IS NOT NULL OR h.away_possession IS NOT NULL
        OR h.home_shots_on_target IS NOT NULL OR h.away_shots_on_target IS NOT NULL
        OR h.home_fouls IS NOT NULL OR h.away_fouls IS NOT NULL OR h.home_yellow_cards IS NOT NULL OR h.away_yellow_cards IS NOT NULL
        OR h.home_red_cards IS NOT NULL OR h.away_red_cards IS NOT NULL OR h.home_xg IS NOT NULL OR h.away_xg IS NOT NULL)::int stats,
      count(m.id) FILTER(WHERE o.match_id IS NOT NULL)::int odds,
      count(m.id) FILTER(WHERE o.bookmakers>=3)::int odds_three,
      COALESCE(sum(o.snapshots),0)::int odds_snapshots,
      count(m.id) FILTER(WHERE co.match_id IS NOT NULL)::int csv_odds,
      count(m.id) FILTER(WHERE co.bookmakers>=3)::int csv_odds_three,
      COALESCE(sum(co.quotes),0)::int csv_odds_quotes,
      COALESCE(se.matches,0)::int csv_stage_matches,
      COALESCE(se.examples,0)::int csv_stage_examples,
      COALESCE(se.research_eligible,0)::int csv_stage_research_eligible,
      count(m.id) FILTER(WHERE m.status='scheduled' AND m.kickoff_at>=now() AND m.kickoff_at<now()+interval '7 days')::int upcoming_matches,
      count(m.id) FILTER(WHERE m.status='scheduled' AND m.kickoff_at>=now() AND m.kickoff_at<now()+interval '7 days'
        AND o.match_id IS NOT NULL)::int upcoming_odds,
      count(m.id) FILTER(WHERE m.status='scheduled' AND m.kickoff_at>=now() AND m.kickoff_at<now()+interval '7 days'
        AND o.bookmakers>=3)::int upcoming_odds_three,
      count(m.id) FILTER(WHERE s.corners OR (h.home_corners IS NOT NULL AND h.away_corners IS NOT NULL))::int corners,
      COALESCE(e.count,0)::int examples,min(m.kickoff_at) earliest,max(m.kickoff_at) latest
    FROM leagues l LEFT JOIN matches m ON m.league_id=l.id LEFT JOIN stats s ON s.match_id=m.id
    LEFT JOIN odds o ON o.match_id=m.id LEFT JOIN csv_odds co ON co.match_id=m.id
    LEFT JOIN historical_match_stats h ON h.match_id=m.id
    LEFT JOIN stage_examples se ON se.competition_id=l.id
    LEFT JOIN examples e ON e.competition_id=l.id
    GROUP BY l.id,l.name,e.count,se.matches,se.examples,se.research_eligible ORDER BY l.name`);
    const [reports,csvImports,csvStageRefreshes,shadowSafety] = await Promise.all([
      this.pool.query<{ report: ExpansionReport }>(`SELECT cursor->'report' report FROM collector_checkpoints
        WHERE provider='fotmob' AND scope LIKE 'competition-expansion:%' AND cursor ? 'report' ORDER BY updated_at DESC`),
      this.pool.query(`SELECT source_key,competition,season,status,total_rows,valid_rows,imported_rows,statistics_rows,odds_rows,
        cursor_row,last_error,started_at,completed_at,updated_at FROM historical_csv_imports
        ORDER BY season DESC,competition`),
      this.pool.query(`SELECT source_key,status,matches_inspected,examples_inserted,research_eligible_examples,
        last_error,started_at,completed_at,updated_at FROM prediction_stage_historical_refreshes
        ORDER BY updated_at DESC`),
      this.pool.query(`SELECT count(*)::int total,
        count(*) FILTER(WHERE official_eligible)::int invalid_official,
        count(*) FILTER(WHERE timing_known)::int invalid_timing_known
        FROM prediction_stage_historical_examples`),
    ]);
    const competitions = enrichCoverageTargets(coverageRows(result.rows, this.configured));
    const sum = (key: 'matches' | 'finishedMatches' | 'predictionHistoricalExamples' | 'matchesWithOdds' | 'matchesWithStats'
      | 'matchesWithThreeBookmakers' | 'oddsSnapshots' | 'csvHistoricalOddsMatches' | 'csvHistoricalThreeBookmakers'
      | 'csvHistoricalOddsQuotes' | 'csvStageMatches' | 'csvStageExamples' | 'csvStageResearchEligible' | 'upcomingMatches7d' | 'upcomingMatchesWithOdds7d'
      | 'upcomingMatchesWithThreeBookmakers7d') => competitions.reduce((total,c) => total+c[key], 0);
    return { competitions, summary: { totalMatches: sum('matches'), totalFinishedMatches: sum('finishedMatches'),
      totalHistoricalExamples: sum('predictionHistoricalExamples'), totalOddsCovered: sum('matchesWithOdds'),
      totalThreeBookmakerCovered: sum('matchesWithThreeBookmakers'), totalOddsSnapshots: sum('oddsSnapshots'),
      csvHistoricalOddsMatches: sum('csvHistoricalOddsMatches'),
      csvHistoricalThreeBookmakers: sum('csvHistoricalThreeBookmakers'),
      csvHistoricalOddsQuotes: sum('csvHistoricalOddsQuotes'),
      csvStageMatches: sum('csvStageMatches'),
      csvStageExamples: sum('csvStageExamples'),
      csvStageResearchEligible: sum('csvStageResearchEligible'),
      upcomingMatches7d: sum('upcomingMatches7d'), upcomingOddsCovered7d: sum('upcomingMatchesWithOdds7d'),
      upcomingThreeBookmakerCovered7d: sum('upcomingMatchesWithThreeBookmakers7d'),
      totalStatsCovered: sum('matchesWithStats') },
      backfills: reports.rows.map(r => r.report).filter(r => competitions.some(c => c.providerId === r.providerId)),
      publicCsvImports: csvImports.rows,
      publicCsvStageRefreshes: csvStageRefreshes.rows,
      shadowSafety: shadowSafety.rows[0] ?? { total:0, invalid_official:0, invalid_timing_known:0 },
      targetPolicy: DATA_TARGET_V1,
      generatedAt: new Date().toISOString(), cacheSeconds: 300 };
  }
}
export type DataCoverage = Awaited<ReturnType<DataCoverageService['get']>>;
