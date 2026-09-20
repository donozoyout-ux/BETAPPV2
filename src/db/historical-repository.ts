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

  async save(provider: HistoricalProviderId, match: NormalizedMatch, statistics: MatchStatistics, fetchedAt = new Date(), refereeExternalId: string | null = null) {
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
      JSON.stringify(historicalFieldPresence(statistics)),JSON.stringify(statistics.raw)]);
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
      ON CONFLICT(match_id) DO UPDATE SET home_goals=excluded.home_goals,away_goals=excluded.away_goals,home_corners=excluded.home_corners,
      away_corners=excluded.away_corners,home_xg=excluded.home_xg,away_xg=excluded.away_xg,home_shots=excluded.home_shots,away_shots=excluded.away_shots,
      home_shots_on_target=excluded.home_shots_on_target,away_shots_on_target=excluded.away_shots_on_target,home_possession=excluded.home_possession,
      away_possession=excluded.away_possession,home_fouls=excluded.home_fouls,away_fouls=excluded.away_fouls,home_yellow_cards=excluded.home_yellow_cards,
      away_yellow_cards=excluded.away_yellow_cards,home_red_cards=excluded.home_red_cards,away_red_cards=excluded.away_red_cards,
      home_offsides=excluded.home_offsides,away_offsides=excluded.away_offsides,referee_external_id=excluded.referee_external_id,
      provider=excluded.provider,source_timestamp=excluded.source_timestamp,data_quality=excluded.data_quality,updated_at=now()`,
    [ids.match_id,ids.competition_id,match.season,match.kickoffAt,ids.home_team_id,ids.away_team_id,match.homeScore,match.awayScore,
      ...corners,...xg,...shots,...shotsOnTarget,...possession,...fouls,...yellow,...red,...offsides,refereeExternalId,provider,statistics.sourceUpdatedAt,dataQuality]);
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
