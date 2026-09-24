import { compactPayloadForStorage } from './repository.js';
import { createHash } from 'node:crypto';
import type { MatchStatistics, NormalizedMatch } from '../domain/types.js';
import { historicalDataQuality, historicalFieldPresence } from '../historical/quality.js';
import { shouldReplaceHistoricalStats } from '../historical/precedence.js';
import type { HistoricalBackfillProgress, HistoricalProviderId } from '../historical/types.js';
import type { DatabasePool } from './pool.js';

function numberValue(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(String(value).replace('%', '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
function metric(statistics: MatchStatistics, keys: string[]) {
  const item = statistics.statistics.find((candidate) => candidate.period === 'ALL' && keys.includes(candidate.key));
  return [numberValue(item?.homeValue), numberValue(item?.awayValue)] as const;
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export class HistoricalRepository {
  constructor(private readonly pool: DatabasePool) {}

  async save(provider: HistoricalProviderId, match: NormalizedMatch, statistics: MatchStatistics, fetchedAt = new Date(), refereeExternalId: string | null = null, preserveMissing = false) {
    const mapping = await this.pool.query<{ match_id: string; competition_id: string; home_team_id: string; away_team_id: string }>(
      `SELECT m.id match_id,m.league_id competition_id,m.home_team_id,m.away_team_id FROM provider_entities pe
       JOIN matches m ON m.id=pe.internal_id WHERE pe.provider=$1 AND pe.entity_type='match' AND pe.external_id=$2`, [provider, match.providerExternalId]);
    const ids = mapping.rows[0];
    if (!ids) throw new Error(`Historical mapping missing: ${provider}/${match.providerExternalId}`);
    const dataQuality = historicalDataQuality(match.homeScore, match.awayScore, statistics);
    const current = await this.pool.query<{ provider: string; data_quality: 'COMPLETE' | 'PARTIAL' | 'LIMITED' | 'POOR' }>(
      'SELECT provider,data_quality FROM historical_match_stats WHERE match_id=$1', [ids.match_id]);
    const rawPayloadHash = hash(statistics.raw);
    await this.pool.query(`INSERT INTO historical_stat_provenance(match_id,provider,provider_external_id,fetched_at,source_updated_at,
      raw_payload_hash,data_quality,normalization_version,field_presence,raw_payload) VALUES($1,$2,$3,$4,$5,$6,$7,'HISTORICAL_V1',$8::jsonb,$9::jsonb)
      ON CONFLICT(match_id,provider,provider_external_id,raw_payload_hash,normalization_version) DO NOTHING`,
    [ids.match_id,provider,match.providerExternalId,fetchedAt,statistics.sourceUpdatedAt,rawPayloadHash,dataQuality,
      JSON.stringify(historicalFieldPresence(statistics)),JSON.stringify(compactPayloadForStorage(statistics.raw))]);
    if (!shouldReplaceHistoricalStats(current.rows[0]?.provider ?? null, current.rows[0]?.data_quality ?? null, provider, dataQuality)) {
      return { action: 'duplicate' as const, dataQuality };
    }
    const corners = metric(statistics, ['corners', 'corner_kicks']); const xg = metric(statistics, ['expected_goals_xg', 'expected_goals']);
    const shots = metric(statistics, ['total_shots']); const shotsOnTarget = metric(statistics, ['shots_on_target']);
    const possession = metric(statistics, ['ball_possession']); const fouls = metric(statistics, ['fouls_committed', 'fouls']);
    const yellow = metric(statistics, ['yellow_cards']); const red = metric(statistics, ['red_cards']); const offsides = metric(statistics, ['offsides']);
    const result = await this.pool.query(`INSERT INTO historical_match_stats(match_id,competition_id,season,kickoff_at,home_team_id,away_team_id,
      home_goals,away_goals,home_corners,away_corners,home_xg,away_xg,home_shots,away_shots,home_shots_on_target,away_shots_on_target,
      home_possession,away_possession,home_fouls,away_fouls,home_yellow_cards,away_yellow_cards,home_red_cards,away_red_cards,
      home_offsides,away_offsides,referee_external_id,provider,source_timestamp,data_quality)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
      ON CONFLICT(match_id) DO UPDATE SET home_goals=CASE WHEN $31::boolean THEN COALESCE(excluded.home_goals,historical_match_stats.home_goals) ELSE excluded.home_goals END,away_goals=CASE WHEN $31::boolean THEN COALESCE(excluded.away_goals,historical_match_stats.away_goals) ELSE excluded.away_goals END,home_corners=CASE WHEN $31::boolean THEN COALESCE(excluded.home_corners,historical_match_stats.home_corners) ELSE excluded.home_corners END,
      away_corners=CASE WHEN $31::boolean THEN COALESCE(excluded.away_corners,historical_match_stats.away_corners) ELSE excluded.away_corners END,home_xg=CASE WHEN $31::boolean THEN COALESCE(excluded.home_xg,historical_match_stats.home_xg) ELSE excluded.home_xg END,away_xg=CASE WHEN $31::boolean THEN COALESCE(excluded.away_xg,historical_match_stats.away_xg) ELSE excluded.away_xg END,home_shots=CASE WHEN $31::boolean THEN COALESCE(excluded.home_shots,historical_match_stats.home_shots) ELSE excluded.home_shots END,away_shots=CASE WHEN $31::boolean THEN COALESCE(excluded.away_shots,historical_match_stats.away_shots) ELSE excluded.away_shots END,
      home_shots_on_target=CASE WHEN $31::boolean THEN COALESCE(excluded.home_shots_on_target,historical_match_stats.home_shots_on_target) ELSE excluded.home_shots_on_target END,away_shots_on_target=CASE WHEN $31::boolean THEN COALESCE(excluded.away_shots_on_target,historical_match_stats.away_shots_on_target) ELSE excluded.away_shots_on_target END,home_possession=CASE WHEN $31::boolean THEN COALESCE(excluded.home_possession,historical_match_stats.home_possession) ELSE excluded.home_possession END,
      away_possession=CASE WHEN $31::boolean THEN COALESCE(excluded.away_possession,historical_match_stats.away_possession) ELSE excluded.away_possession END,home_fouls=CASE WHEN $31::boolean THEN COALESCE(excluded.home_fouls,historical_match_stats.home_fouls) ELSE excluded.home_fouls END,away_fouls=CASE WHEN $31::boolean THEN COALESCE(excluded.away_fouls,historical_match_stats.away_fouls) ELSE excluded.away_fouls END,home_yellow_cards=CASE WHEN $31::boolean THEN COALESCE(excluded.home_yellow_cards,historical_match_stats.home_yellow_cards) ELSE excluded.home_yellow_cards END,
      away_yellow_cards=CASE WHEN $31::boolean THEN COALESCE(excluded.away_yellow_cards,historical_match_stats.away_yellow_cards) ELSE excluded.away_yellow_cards END,home_red_cards=CASE WHEN $31::boolean THEN COALESCE(excluded.home_red_cards,historical_match_stats.home_red_cards) ELSE excluded.home_red_cards END,away_red_cards=CASE WHEN $31::boolean THEN COALESCE(excluded.away_red_cards,historical_match_stats.away_red_cards) ELSE excluded.away_red_cards END,
      home_offsides=CASE WHEN $31::boolean THEN COALESCE(excluded.home_offsides,historical_match_stats.home_offsides) ELSE excluded.home_offsides END,away_offsides=CASE WHEN $31::boolean THEN COALESCE(excluded.away_offsides,historical_match_stats.away_offsides) ELSE excluded.away_offsides END,referee_external_id=CASE WHEN $31::boolean THEN COALESCE(excluded.referee_external_id,historical_match_stats.referee_external_id) ELSE excluded.referee_external_id END,
      provider=excluded.provider,source_timestamp=excluded.source_timestamp,data_quality=excluded.data_quality,updated_at=now()`,
    [ids.match_id,ids.competition_id,match.season,match.kickoffAt,ids.home_team_id,ids.away_team_id,match.homeScore,match.awayScore,
      ...corners,...xg,...shots,...shotsOnTarget,...possession,...fouls,...yellow,...red,...offsides,refereeExternalId,provider,statistics.sourceUpdatedAt,dataQuality,preserveMissing]);
    return { action: current.rows[0] ? 'updated' as const : 'inserted' as const, dataQuality, rowCount: result.rowCount ?? 0 };
  }

  async startJob(provider: string, competitionId: string, season: string, requested: number) {
    const result = await this.pool.query<{ id: string; cursor: Record<string, unknown> }>(`INSERT INTO historical_backfill_jobs(provider,competition_id,season,status,requested)
      VALUES($1,$2,$3,'RUNNING',$4) ON CONFLICT(provider,competition_id,season) DO UPDATE SET status='RUNNING',requested=excluded.requested,
      updated_at=now(),completed_at=NULL RETURNING id,cursor`, [provider,competitionId,season,requested]);
    return result.rows[0]!;
  }
  async updateJob(id: string, progress: HistoricalBackfillProgress, status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'DRY_RUN', lastError: string | null = null) {
    await this.pool.query(`UPDATE historical_backfill_jobs SET cursor=$2::jsonb,status=$3,requested=$4,received=$5,inserted=$6,updated=$7,
      duplicates=$8,errors=$9,last_error=$10,updated_at=now(),completed_at=CASE WHEN $3 IN('COMPLETED','FAILED','DRY_RUN') THEN now() END WHERE id=$1`,
    [id,JSON.stringify(progress.cursor),status,progress.requested,progress.received,progress.inserted,progress.updated,progress.duplicates,progress.errors,lastError]);
  }
  async expansionReport(providerId: number) {
    const row = await this.pool.query<{ cursor: { report?: import('../historical/competition-scope.js').ExpansionReport } }>(
      "SELECT cursor FROM collector_checkpoints WHERE provider='fotmob' AND scope=$1", [`competition-expansion:${providerId}`]);
    return row.rows[0]?.cursor.report ?? null;
  }
  async saveExpansionReport(report: import('../historical/competition-scope.js').ExpansionReport) {
    await this.pool.query(`INSERT INTO collector_checkpoints(provider,scope,cursor,last_started_at,last_succeeded_at)
      VALUES('fotmob',$1,$2::jsonb,$3,$4) ON CONFLICT(provider,scope) DO UPDATE SET cursor=excluded.cursor,
      last_started_at=excluded.last_started_at,last_succeeded_at=excluded.last_succeeded_at,updated_at=now()`,
    [`competition-expansion:${report.providerId}`, JSON.stringify({ report }), report.startedAt, report.completedAt]);
  }
  async detailsImported(externalId: string) {
    const result = await this.pool.query(`SELECT 1 FROM historical_stat_provenance p
      JOIN provider_entities pe ON pe.internal_id=p.match_id AND pe.entity_type='match'
      JOIN historical_match_stats h ON h.match_id=p.match_id
      WHERE pe.provider='fotmob' AND pe.external_id=$1 AND p.provider='fotmob'
      AND COALESCE(p.raw_payload->>'unavailable','false') <> 'true' LIMIT 1`, [externalId]);
    return result.rows.length > 0;
  }
  async competitionEvidence(name: string) {
    const result = await this.pool.query(`SELECT
      (SELECT count(*)::int FROM prediction_historical_examples e JOIN leagues l ON l.id=e.competition_id WHERE l.name=$1) examples,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM odds_snapshots o WHERE o.match_id=m.id
        AND o.captured_at < m.kickoff_at AND o.odds_decimal > 1))::int odds,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM historical_match_stats h WHERE h.match_id=m.id
        AND h.home_corners IS NOT NULL AND h.away_corners IS NOT NULL))::int corners
      FROM matches m JOIN leagues l ON l.id=m.league_id WHERE l.name=$1`, [name]);
    return result.rows[0] as { examples: number; odds: number; corners: number };
  }

  async coverageAudit() {
    const result = await this.pool.query(`SELECT l.name competition,h.season,count(*)::int matches,
      count(*) FILTER(WHERE h.home_goals IS NOT NULL AND h.away_goals IS NOT NULL)::int results,
      count(*) FILTER(WHERE h.home_corners IS NOT NULL AND h.away_corners IS NOT NULL)::int corners,
      count(*) FILTER(WHERE h.home_yellow_cards IS NOT NULL AND h.away_yellow_cards IS NOT NULL)::int cards,
      count(*) FILTER(WHERE h.home_shots IS NOT NULL AND h.away_shots IS NOT NULL)::int shots,
      count(*) FILTER(WHERE h.home_shots_on_target IS NOT NULL AND h.away_shots_on_target IS NOT NULL)::int shots_on_target,
      count(*) FILTER(WHERE h.home_fouls IS NOT NULL AND h.away_fouls IS NOT NULL)::int fouls,
      count(*) FILTER(WHERE h.home_offsides IS NOT NULL AND h.away_offsides IS NOT NULL)::int offsides,
      count(*) FILTER(WHERE h.home_possession IS NOT NULL AND h.away_possession IS NOT NULL)::int possession,
      count(*) FILTER(WHERE h.home_xg IS NOT NULL AND h.away_xg IS NOT NULL)::int xg,
      count(*) FILTER(WHERE h.referee_external_id IS NOT NULL)::int referee
      FROM historical_match_stats h JOIN leagues l ON l.id=h.competition_id GROUP BY l.name,h.season ORDER BY l.name,h.season`);
    return result.rows.map((row) => {
      const matches = Number(row.matches); const rate = (key: string) => matches ? Number(row[key]) / matches : 0;
      return { competition: row.competition, season: row.season, matches, results: rate('results'), corners: rate('corners'), cards: rate('cards'),
        shots: rate('shots'), shotsOnTarget: rate('shots_on_target'), fouls: rate('fouls'), offsides: rate('offsides'),
        possession: rate('possession'), xg: rate('xg'), referee: rate('referee') };
    });
  }
}
