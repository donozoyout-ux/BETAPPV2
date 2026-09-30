import type { DatabasePool } from '../db/pool.js';

type CountRow = Record<string, unknown>;
const count = (row: CountRow | undefined, key: string) => Number(row?.[key] ?? 0);

export type PrematchRuntimeStatus = {
  nowgoalEnabled: boolean; nowgoalLiveOddsEnabled: boolean; providerConfigured: boolean;
  collectorInstantiated: boolean; collectorStarted: boolean | null;
};

/**
 * Aggregate-only pre-match coverage. It intentionally has no match IDs, raw prices, payloads,
 * provider URLs, or credentials. Historical cycle detail is limited to durable DB evidence.
 */
export class PrematchCoverageService {
  constructor(private readonly pool: DatabasePool) {}

  async get(windowHours: number, runtime: PrematchRuntimeStatus) {
    const hours = Math.max(1, Math.min(168, Math.trunc(windowHours)));
    const [fixtures, odds, analysis, prediction, historical, dropReasons, activity, byCompetition, checkpoints] = await Promise.all([
      this.pool.query<CountRow>(`/* PREMATCH_FIXTURES */ WITH targets AS (
        SELECT m.id FROM matches m WHERE m.status IN ('scheduled','live')
          AND m.kickoff_at >= now()-interval '3 hours' AND m.kickoff_at < now()+interval '48 hours'
      ) SELECT count(*)::integer total,count(*) FILTER(WHERE true)::integer eligible,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM odds_snapshots s WHERE s.match_id=t.id AND s.captured_at < now()))::integer with_odds,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM odds_analysis_runs a WHERE a.match_id=t.id))::integer with_odds_analysis FROM targets t`),
      this.pool.query<CountRow>(`/* PREMATCH_ODDS */ WITH targets AS (
        SELECT m.id FROM matches m WHERE m.status IN ('scheduled','live')
          AND m.kickoff_at >= now()-interval '3 hours' AND m.kickoff_at < now()+interval '48 hours'
      ), per_match AS (SELECT t.id,count(s.*)::integer snapshots,count(DISTINCT s.provider)::integer bookmakers
        FROM targets t LEFT JOIN odds_snapshots s ON s.match_id=t.id AND s.captured_at < now() GROUP BY t.id), complete AS (
        SELECT DISTINCT a.match_id FROM odds_analysis_runs a JOIN odds_analysis_items i ON i.run_id=a.id
        WHERE i.complete_state_bookmaker_count >= i.minimum_complete_state_count
      ) SELECT COALESCE(sum(snapshots),0)::integer snapshots,count(*) FILTER(WHERE snapshots>0)::integer fixtures_with_snapshots,
        count(*) FILTER(WHERE bookmakers>=3)::integer fixtures_with_3_plus_bookmakers,
        count(*) FILTER(WHERE id IN(SELECT match_id FROM complete))::integer fixtures_with_complete_state FROM per_match`),
      this.pool.query<CountRow>(`/* PREMATCH_ANALYSIS */ WITH targets AS (
        SELECT m.id FROM matches m WHERE m.status IN ('scheduled','live')
          AND m.kickoff_at >= now()-interval '3 hours' AND m.kickoff_at < now()+interval '48 hours'
      ) SELECT count(*) FILTER(WHERE EXISTS(SELECT 1 FROM odds_analysis_runs a WHERE a.match_id=t.id))::integer created,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM odds_collection_state s WHERE s.match_id=t.id AND s.last_status='ERROR'
          AND COALESCE(s.last_error,'') ILIKE '%analysis%'))::integer failed,
        count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM odds_analysis_runs a WHERE a.match_id=t.id))::integer missing FROM targets t`),
      this.pool.query<CountRow>(`/* PREMATCH_PREDICTION */ WITH targets AS (
        SELECT m.id FROM matches m WHERE m.status IN ('scheduled','live')
          AND m.kickoff_at >= now()-interval '3 hours' AND m.kickoff_at < now()+interval '48 hours'
      ), latest AS (SELECT DISTINCT ON(match_id) match_id,decision,candidates FROM prediction_runs ORDER BY match_id,created_at DESC,id DESC)
      SELECT count(*) FILTER(WHERE l.match_id IS NOT NULL)::integer runs,
        count(*) FILTER(WHERE COALESCE(jsonb_array_length(l.candidates),0)>0)::integer candidates,
        count(*) FILTER(WHERE l.decision='PREDICT')::integer predict_runs,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM prediction_journal j WHERE j.match_id=t.id AND j.decision='PREDICT'))::integer locked_predictions FROM targets t LEFT JOIN latest l ON l.match_id=t.id`),
      this.pool.query<CountRow>(`/* PREMATCH_HISTORICAL */ WITH targets AS (
        SELECT m.id FROM matches m WHERE m.status IN ('scheduled','live')
          AND m.kickoff_at >= now()-interval '3 hours' AND m.kickoff_at < now()+interval '48 hours'
      ), latest AS (SELECT DISTINCT ON(match_id) match_id,candidates FROM prediction_runs ORDER BY match_id,created_at DESC,id DESC), samples AS (
        SELECT t.id,COALESCE(max((candidate #>> '{historical,settledSampleSize}')::integer),0)::integer sample
        FROM targets t LEFT JOIN latest l ON l.match_id=t.id LEFT JOIN LATERAL jsonb_array_elements(COALESCE(l.candidates,'[]'::jsonb)) candidate ON true GROUP BY t.id)
      SELECT COALESCE(max(sample),0)::integer max_sample,COALESCE(avg(sample),0)::numeric avg_sample,
        count(*) FILTER(WHERE sample>=30)::integer sample_30_count,count(*) FILTER(WHERE sample>=20)::integer sample_20_plus_count FROM samples`),
      this.pool.query<CountRow>(`/* PREMATCH_DROP_REASONS */ WITH latest AS (
        SELECT DISTINCT ON(r.match_id) r.skip_reasons FROM prediction_runs r JOIN matches m ON m.id=r.match_id
        WHERE m.status IN ('scheduled','live') AND m.kickoff_at >= now()-interval '3 hours' AND m.kickoff_at < now()+interval '48 hours'
        ORDER BY r.match_id,r.created_at DESC,r.id DESC)
      SELECT reason,count(*)::integer count FROM latest CROSS JOIN LATERAL jsonb_array_elements_text(skip_reasons) reason GROUP BY reason ORDER BY count DESC,reason`),
      this.pool.query<CountRow>(`/* PREMATCH_ACTIVITY */ SELECT
        count(*) FILTER(WHERE last_attempt_at >= now()-($1::text||' hours')::interval)::integer selected_fixtures,
        count(*) FILTER(WHERE last_attempt_at >= now()-($1::text||' hours')::interval AND last_status='SUCCESS')::integer provider_requests,
        count(*) FILTER(WHERE last_attempt_at >= now()-($1::text||' hours')::interval AND last_status='NO_ODDS')::integer skipped_fixtures,
        count(*) FILTER(WHERE last_attempt_at >= now()-($1::text||' hours')::interval AND last_status='ERROR')::integer errors,
        COALESCE(sum(snapshots_inserted) FILTER(WHERE last_attempt_at >= now()-($1::text||' hours')::interval),0)::integer snapshot_writes
        FROM odds_collection_state`, [hours]),
      this.pool.query<CountRow>(`/* PREMATCH_HISTORICAL_BY_COMPETITION */ SELECT l.name competition,
        CASE WHEN extract(month FROM m.kickoff_at)>=7 THEN extract(year FROM m.kickoff_at)::text||'-'||(extract(year FROM m.kickoff_at)::integer+1)::text
          ELSE (extract(year FROM m.kickoff_at)::integer-1)::text||'-'||extract(year FROM m.kickoff_at)::text END season,
        count(*) FILTER(WHERE m.status='finished')::integer finished_matches,
        count(phe.*) FILTER(WHERE phe.analysis_eligible)::integer eligible_historical_matches,
        count(phe.*)::integer supported_historical_matches
        FROM leagues l JOIN matches m ON m.league_id=l.id LEFT JOIN prediction_historical_examples phe ON phe.match_id=m.id
        GROUP BY l.name,season ORDER BY supported_historical_matches DESC,competition,season LIMIT 100`),
      this.pool.query<CountRow>(`/* PREMATCH_CHECKPOINTS */ SELECT provider,scope,last_started_at,last_succeeded_at,last_failed_at,
        CASE WHEN last_started_at IS NULL THEN false ELSE true END collector_started FROM collector_checkpoints
        WHERE scope IN ('prematch-odds','prematch-odds-api-football') ORDER BY provider,scope`),
    ]);
    const fixture = fixtures.rows[0] ?? {};
    const oddsRow = odds.rows[0] ?? {};
    const analysisRow = analysis.rows[0] ?? {};
    const predictionRow = prediction.rows[0] ?? {};
    const historicalRow = historical.rows[0] ?? {};
    const total = count(fixture, 'total');
    const withSnapshots = count(oddsRow, 'fixtures_with_snapshots');
    const withAnalysis = count(fixture, 'with_odds_analysis');
    const candidates = count(predictionRow, 'candidates');
    const drops = [
      { reason: 'NO_ODDS_SNAPSHOT', count: Math.max(0, total-withSnapshots) },
      { reason: 'NO_ODDS_ANALYSIS', count: Math.max(0, withSnapshots-withAnalysis) },
      { reason: 'NO_PREDICTION_CANDIDATE', count: Math.max(0, withAnalysis-candidates) },
      ...dropReasons.rows.map((row) => ({ reason: String(row.reason), count: count(row, 'count') })),
    ].filter((row) => row.count > 0);
    return {
      version: 'PREMATCH_DATA_COVERAGE_V2', detail: 'prematch', generatedAt: new Date().toISOString(), windowHours: hours,
      fixtures: { total, eligible: count(fixture, 'eligible'), withOdds: count(fixture, 'with_odds'), withOddsAnalysis: withAnalysis },
      odds: { snapshots: count(oddsRow, 'snapshots'), fixturesWithSnapshots: withSnapshots,
        fixturesWith3PlusBookmakers: count(oddsRow, 'fixtures_with_3_plus_bookmakers'),
        fixturesWithCompleteState: count(oddsRow, 'fixtures_with_complete_state') },
      analysis: { created: count(analysisRow, 'created'), failed: count(analysisRow, 'failed'), missing: count(analysisRow, 'missing') },
      prediction: { runs: count(predictionRow, 'runs'), candidates, predictRuns: count(predictionRow, 'predict_runs'), lockedPredictions: count(predictionRow, 'locked_predictions') },
      historical: { maxSample: count(historicalRow, 'max_sample'), avgSample: Number(historicalRow.avg_sample ?? 0),
        sample30Count: count(historicalRow, 'sample_30_count'), sample20PlusCount: count(historicalRow, 'sample_20_plus_count'),
        byCompetition: byCompetition.rows.map((row) => ({ competition: String(row.competition), season: String(row.season),
          finishedMatches: count(row, 'finished_matches'), eligibleHistoricalMatches: count(row, 'eligible_historical_matches'),
          supportedHistoricalMatches: count(row, 'supported_historical_matches') })) },
      dropReasons: drops, runtime: { ...runtime, collectorStarted: checkpoints.rows.some((row) => row.collector_started === true) ? true : runtime.collectorStarted },
      last24h: { collectorCycles: null, cycleMetricAvailability: 'CHECKPOINT_ONLY_NO_HISTORICAL_CYCLE_LOG',
        selectedFixtures: count(activity.rows[0], 'selected_fixtures'), skippedFixtures: count(activity.rows[0], 'skipped_fixtures'),
        providerRequests: count(activity.rows[0], 'provider_requests'), httpStatusDistribution: null,
        httpStatusAvailability: 'NOT_PERSISTED_IN_COLLECTOR_STATE',
        normalizedQuoteCount: null, snapshotWriteCount: count(activity.rows[0], 'snapshot_writes'), oddsAnalysisCount: null,
        errors: count(activity.rows[0], 'errors'), skipReasons: [], skipReasonsAvailability: 'NOT_PERSISTED_FOR_UNMATCHED_PROVIDER_FIXTURES' },
      stages: [
        { stage: 'fixture_discovered', count: total, percentage: total ? 100 : 0, dropCount: 0, dropReasons: [] },
        { stage: 'fixture_eligible', count: count(fixture, 'eligible'), percentage: total ? count(fixture, 'eligible') / total * 100 : 0,
          dropCount: total-count(fixture, 'eligible'), dropReasons: [] },
        { stage: 'prematch_collector_selected', count: null, percentage: null, dropCount: null,
          dropReasons: ['NOT_PERSISTED_FOR_UNMATCHED_PROVIDER_FIXTURES'] },
        { stage: 'provider_request', count: count(activity.rows[0], 'provider_requests'), percentage: null, dropCount: null,
          scope: `last_${hours}h`, dropReasons: [] },
        { stage: 'provider_response', count: null, percentage: null, dropCount: null, dropReasons: ['HTTP_STATUS_NOT_PERSISTED'] },
        { stage: 'odds_normalized', count: null, percentage: null, dropCount: null, dropReasons: ['NORMALIZED_QUOTE_COUNT_NOT_PERSISTED'] },
        { stage: 'three_plus_bookmakers', count: count(oddsRow, 'fixtures_with_3_plus_bookmakers'),
          percentage: total ? count(oddsRow, 'fixtures_with_3_plus_bookmakers') / total * 100 : 0,
          dropCount: Math.max(0, withSnapshots-count(oddsRow, 'fixtures_with_3_plus_bookmakers')), dropReasons: ['INSUFFICIENT_BOOKMAKERS'] },
        { stage: 'odds_snapshot_written', count: withSnapshots, percentage: total ? withSnapshots / total * 100 : 0,
          dropCount: total-withSnapshots, dropReasons: ['NO_ODDS_SNAPSHOT'] },
        { stage: 'odds_analysis_created', count: withAnalysis, percentage: total ? withAnalysis / total * 100 : 0,
          dropCount: Math.max(0, withSnapshots-withAnalysis), dropReasons: ['NO_ODDS_ANALYSIS'] },
        { stage: 'prediction_candidate_created', count: candidates, percentage: total ? candidates / total * 100 : 0,
          dropCount: Math.max(0, withAnalysis-candidates), dropReasons: ['NO_PREDICTION_CANDIDATE'] },
        { stage: 'historical_candidates_found', count: candidates, percentage: total ? candidates / total * 100 : 0,
          dropCount: Math.max(0, withAnalysis-candidates), dropReasons: [] },
        { stage: 'historical_sample_30', count: count(historicalRow, 'sample_30_count'), percentage: total ? count(historicalRow, 'sample_30_count') / total * 100 : 0,
          dropCount: Math.max(0, candidates-count(historicalRow, 'sample_30_count')), dropReasons: ['INSUFFICIENT_HISTORICAL_SAMPLE'] },
        { stage: 'prediction_gate', count: count(predictionRow, 'runs'), percentage: total ? count(predictionRow, 'runs') / total * 100 : 0,
          dropCount: Math.max(0, withAnalysis-count(predictionRow, 'runs')), dropReasons: dropReasons.rows.map((row) => String(row.reason)) },
        { stage: 'official_prediction', count: count(predictionRow, 'locked_predictions'), percentage: total ? count(predictionRow, 'locked_predictions') / total * 100 : 0,
          dropCount: Math.max(0, candidates-count(predictionRow, 'locked_predictions')), dropReasons: ['PREDICTION_GATE_NOT_PASSED'] },
      ],
    };
  }
}
