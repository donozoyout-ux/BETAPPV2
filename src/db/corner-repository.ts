import type { MatchStatistics, NormalizedMatch } from '../domain/types.js';
import type { CornerAnalysis, HistoricalCornerMatch, LeagueCornerBaseline, TeamCornerProfile } from '../corners/types.js';
import type { CornerModelConfig } from '../corners/config.js';
import type { DatabasePool } from './pool.js';
import { isCompetitionConfigured } from '../matching/competition.js';

function numberValue(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(String(value).replace('%', '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function stat(data: MatchStatistics, keys: string[], period = 'ALL') {
  return data.statistics.find((item) => item.period === period && keys.includes(item.key));
}

function rawObject(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export type BackfillProgress = {
  fixturesDiscovered: number; matchesFetched: number; matchesStored: number; cornerComplete: number;
  partial: number; failed: number; retries: number; lastCheckpoint: number;
};

export class CornerRepository {
  constructor(private readonly pool: DatabasePool) {}

  async saveHistorical(provider: string, normalized: NormalizedMatch, statistics: MatchStatistics) {
    const mapped = await this.pool.query<{ match_id: string; competition_id: string; home_team_id: string; away_team_id: string }>(
      `SELECT m.id match_id,m.league_id competition_id,m.home_team_id,m.away_team_id FROM provider_entities pe
       JOIN matches m ON m.id=pe.internal_id WHERE pe.provider=$1 AND pe.entity_type='match' AND pe.external_id=$2`,
      [provider, normalized.providerExternalId]);
    const ids = mapped.rows[0];
    if (!ids) throw new Error(`Internal match mapping missing: ${provider}/${normalized.providerExternalId}`);
    const metric = (keys: string[], period = 'ALL') => {
      const item = stat(statistics, keys, period);
      return [numberValue(item?.homeValue), numberValue(item?.awayValue)] as const;
    };
    const corners = metric(['corners', 'corner_kicks']);
    const firstHalfCorners = metric(['corners', 'corner_kicks'], 'FirstHalf');
    const xg = metric(['expected_goals_xg', 'expected_goals']);
    const shots = metric(['total_shots']);
    const shotsOnTarget = metric(['shots_on_target']);
    const possession = metric(['ball_possession']);
    const fouls = metric(['fouls_committed', 'fouls']);
    const yellow = metric(['yellow_cards']);
    const red = metric(['red_cards']);
    const raw = rawObject(statistics.raw);
    const lineupMetadata = raw.lineup ?? null;
    const refereeMetadata = raw.infoBox ?? null;
    await this.pool.query(
      `INSERT INTO historical_match_stats(match_id,competition_id,season,kickoff_at,home_team_id,away_team_id,
       home_goals,away_goals,home_corners,away_corners,first_half_home_corners,first_half_away_corners,
       home_xg,away_xg,home_shots,away_shots,home_shots_on_target,away_shots_on_target,home_possession,away_possession,
       home_fouls,away_fouls,home_yellow_cards,away_yellow_cards,home_red_cards,away_red_cards,provider,source_timestamp,
       lineup_metadata,referee_metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30::jsonb)
       ON CONFLICT(match_id) DO UPDATE SET home_goals=excluded.home_goals,away_goals=excluded.away_goals,
       home_corners=excluded.home_corners,away_corners=excluded.away_corners,first_half_home_corners=excluded.first_half_home_corners,
       first_half_away_corners=excluded.first_half_away_corners,home_xg=excluded.home_xg,away_xg=excluded.away_xg,
       home_shots=excluded.home_shots,away_shots=excluded.away_shots,home_shots_on_target=excluded.home_shots_on_target,
       away_shots_on_target=excluded.away_shots_on_target,home_possession=excluded.home_possession,away_possession=excluded.away_possession,
       home_fouls=excluded.home_fouls,away_fouls=excluded.away_fouls,home_yellow_cards=excluded.home_yellow_cards,
       away_yellow_cards=excluded.away_yellow_cards,home_red_cards=excluded.home_red_cards,away_red_cards=excluded.away_red_cards,
       source_timestamp=excluded.source_timestamp,lineup_metadata=excluded.lineup_metadata,
       referee_metadata=excluded.referee_metadata,updated_at=now()`,
      [ids.match_id, ids.competition_id, normalized.season, normalized.kickoffAt, ids.home_team_id, ids.away_team_id,
        normalized.homeScore, normalized.awayScore, ...corners, ...firstHalfCorners, ...xg, ...shots, ...shotsOnTarget,
        ...possession, ...fouls, ...yellow, ...red, provider, statistics.sourceUpdatedAt,
        lineupMetadata == null ? null : JSON.stringify(lineupMetadata), refereeMetadata == null ? null : JSON.stringify(refereeMetadata)]);
  }

  async loadHistory(finishedOnly = false): Promise<HistoricalCornerMatch[]> {
    const result = await this.pool.query(`SELECT h.*,l.name competition_name,ht.name home_team_name,at.name away_team_name
      FROM historical_match_stats h JOIN leagues l ON l.id=h.competition_id
      JOIN teams ht ON ht.id=h.home_team_id JOIN teams at ON at.id=h.away_team_id
      JOIN matches m ON m.id=h.match_id WHERE ($1::boolean=false OR m.status='finished') ORDER BY h.kickoff_at`, [finishedOnly]);
    return result.rows.map((row) => ({
      matchId: row.match_id, competitionId: row.competition_id, season: row.season ?? 'unknown', kickoffAt: new Date(row.kickoff_at),
      homeTeamId: row.home_team_id, awayTeamId: row.away_team_id, homeGoals: numberValue(row.home_goals), awayGoals: numberValue(row.away_goals),
      homeCorners: numberValue(row.home_corners), awayCorners: numberValue(row.away_corners),
      firstHalfHomeCorners: numberValue(row.first_half_home_corners), firstHalfAwayCorners: numberValue(row.first_half_away_corners),
      homeXg: numberValue(row.home_xg), awayXg: numberValue(row.away_xg), homeShots: numberValue(row.home_shots), awayShots: numberValue(row.away_shots),
      homeShotsOnTarget: numberValue(row.home_shots_on_target), awayShotsOnTarget: numberValue(row.away_shots_on_target),
      homePossession: numberValue(row.home_possession), awayPossession: numberValue(row.away_possession), homeFouls: numberValue(row.home_fouls),
      awayFouls: numberValue(row.away_fouls), homeYellowCards: numberValue(row.home_yellow_cards), awayYellowCards: numberValue(row.away_yellow_cards),
      homeRedCards: numberValue(row.home_red_cards), awayRedCards: numberValue(row.away_red_cards), provider: row.provider,
      sourceTimestamp: new Date(row.source_timestamp),
      competitionName: row.competition_name, homeTeamName: row.home_team_name, awayTeamName: row.away_team_name,
    }));
  }

  async startBackfillRun(competitionExternalId: string, competitionName: string, season: string, fixturesDiscovered: number, dryRun: boolean) {
    const result = await this.pool.query<{ id: string; matches_fetched: number; matches_stored: number; corner_complete: number;
      partial: number; failed: number; retries: number; last_checkpoint: number }>(
      `INSERT INTO backfill_runs(provider,competition_external_id,competition_name,season,status,fixtures_discovered)
       VALUES('fotmob',$1,$2,$3,$4,$5)
       ON CONFLICT(provider,competition_external_id,season) DO UPDATE SET competition_name=excluded.competition_name,
       status=excluded.status,fixtures_discovered=excluded.fixtures_discovered,started_at=now(),completed_at=NULL,updated_at=now()
       RETURNING id,matches_fetched,matches_stored,corner_complete,partial,failed,retries,last_checkpoint`,
      [competitionExternalId, competitionName, season, dryRun ? 'DRY_RUN' : 'RUNNING', fixturesDiscovered]);
    const row = result.rows[0]!;
    return { id: row.id, progress: { fixturesDiscovered, matchesFetched: Number(row.matches_fetched), matchesStored: Number(row.matches_stored),
      cornerComplete: Number(row.corner_complete), partial: Number(row.partial), failed: Number(row.failed), retries: Number(row.retries),
      lastCheckpoint: Number(row.last_checkpoint) } satisfies BackfillProgress };
  }

  async updateBackfillRun(id: string, progress: BackfillProgress, status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'DRY_RUN' = 'RUNNING') {
    await this.pool.query(
      `UPDATE backfill_runs SET status=$2,fixtures_discovered=$3,matches_fetched=$4,matches_stored=$5,
       corner_complete=$6,partial=$7,failed=$8,retries=$9,last_checkpoint=$10,
       completed_at=CASE WHEN $2 IN ('COMPLETED','FAILED','DRY_RUN') THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`,
      [id,status,progress.fixturesDiscovered,progress.matchesFetched,progress.matchesStored,progress.cornerComplete,
        progress.partial,progress.failed,progress.retries,progress.lastCheckpoint]);
  }

  async recordBackfillFailure(competitionExternalId: string, season: string, matchExternalId: string,
    classification: 'RETRYABLE' | 'PERMANENT', error: unknown) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await this.pool.query(
      `INSERT INTO backfill_failures(provider,competition_external_id,season,match_external_id,classification,last_error)
       VALUES('fotmob',$1,$2,$3,$4,$5)
       ON CONFLICT(provider,competition_external_id,season,match_external_id) DO UPDATE SET
       classification=excluded.classification,attempts=backfill_failures.attempts+1,last_error=excluded.last_error,
       last_failed_at=now(),resolved_at=NULL`, [competitionExternalId,season,matchExternalId,classification,message.slice(0,2000)]);
  }

  async resolveBackfillFailure(competitionExternalId: string, season: string, matchExternalId: string) {
    await this.pool.query(`UPDATE backfill_failures SET resolved_at=now() WHERE provider='fotmob' AND competition_external_id=$1
      AND season=$2 AND match_external_id=$3`, [competitionExternalId,season,matchExternalId]);
  }

  async saveDatasetAudit(report: unknown) {
    await this.pool.query('INSERT INTO dataset_audits(report) VALUES($1::jsonb)', [JSON.stringify(report)]);
  }

  async auditIntegrity() {
    const result = await this.pool.query<{ duplicate_matches: string; duplicate_team_stats: string; duplicate_provider_mappings: string }>(
      `SELECT
       (SELECT count(*) FROM (SELECT league_id,home_team_id,away_team_id,kickoff_at FROM matches GROUP BY 1,2,3,4 HAVING count(*)>1) d) duplicate_matches,
       (SELECT count(*) FROM (SELECT match_id,provider,period,stat_key FROM match_statistics GROUP BY 1,2,3,4 HAVING count(*)>1) d) duplicate_team_stats,
       (SELECT count(*) FROM (SELECT provider,entity_type,external_id FROM provider_entities GROUP BY 1,2,3 HAVING count(*)>1) d) duplicate_provider_mappings`);
    return { duplicateMatches: Number(result.rows[0]!.duplicate_matches), duplicateTeamStats: Number(result.rows[0]!.duplicate_team_stats),
      duplicateProviderMappings: Number(result.rows[0]!.duplicate_provider_mappings) };
  }

  async saveProfiles(profiles: TeamCornerProfile[]) {
    if (!profiles.length) return;
    const payload = profiles.map((item) => ({ team_id: item.teamId, competition_id: item.competitionId, season: item.season,
      window_type: item.windowType, venue: item.venue, sample_size: item.sampleSize, corners_for_avg: item.cornersForAvg,
      corners_against_avg: item.cornersAgainstAvg, total_match_corners_avg: item.totalMatchCornersAvg,
      corners_for_stddev: item.cornersForStddev, corners_against_stddev: item.cornersAgainstStddev,
      over_7_5_rate: item.overRates['7.5'], over_8_5_rate: item.overRates['8.5'], over_9_5_rate: item.overRates['9.5'],
      over_10_5_rate: item.overRates['10.5'], over_11_5_rate: item.overRates['11.5'], over_12_5_rate: item.overRates['12.5'],
      first_half_corners_for_avg: item.firstHalfCornersForAvg, first_half_corners_against_avg: item.firstHalfCornersAgainstAvg }));
    await this.pool.query(
      `INSERT INTO team_corner_profiles(team_id,competition_id,season,window_type,venue,sample_size,corners_for_avg,corners_against_avg,
       total_match_corners_avg,corners_for_stddev,corners_against_stddev,over_7_5_rate,over_8_5_rate,over_9_5_rate,
       over_10_5_rate,over_11_5_rate,over_12_5_rate,first_half_corners_for_avg,first_half_corners_against_avg)
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(team_id uuid,competition_id uuid,season text,window_type text,venue text,
       sample_size integer,corners_for_avg numeric,corners_against_avg numeric,total_match_corners_avg numeric,
       corners_for_stddev numeric,corners_against_stddev numeric,over_7_5_rate numeric,over_8_5_rate numeric,over_9_5_rate numeric,
       over_10_5_rate numeric,over_11_5_rate numeric,over_12_5_rate numeric,first_half_corners_for_avg numeric,
       first_half_corners_against_avg numeric)
       ON CONFLICT(team_id,competition_id,season,window_type,venue) DO UPDATE SET sample_size=excluded.sample_size,
       corners_for_avg=excluded.corners_for_avg,corners_against_avg=excluded.corners_against_avg,total_match_corners_avg=excluded.total_match_corners_avg,
       corners_for_stddev=excluded.corners_for_stddev,corners_against_stddev=excluded.corners_against_stddev,
       over_7_5_rate=excluded.over_7_5_rate,over_8_5_rate=excluded.over_8_5_rate,over_9_5_rate=excluded.over_9_5_rate,
       over_10_5_rate=excluded.over_10_5_rate,over_11_5_rate=excluded.over_11_5_rate,over_12_5_rate=excluded.over_12_5_rate,
       first_half_corners_for_avg=excluded.first_half_corners_for_avg,first_half_corners_against_avg=excluded.first_half_corners_against_avg,calculated_at=now()`,
      [JSON.stringify(payload)]);
  }

  async saveBaselines(items: LeagueCornerBaseline[]) {
    if (!items.length) return;
    const payload = items.map((item) => ({ competition_id: item.competitionId, season: item.season,
      avg_home_corners: item.avgHomeCorners, avg_away_corners: item.avgAwayCorners, avg_total_corners: item.avgTotalCorners,
      stddev_total_corners: item.stddevTotalCorners, variance_total_corners: item.varianceTotalCorners,
      over_7_5_rate: item.overRates['7.5'], over_8_5_rate: item.overRates['8.5'], over_9_5_rate: item.overRates['9.5'],
      over_10_5_rate: item.overRates['10.5'], over_11_5_rate: item.overRates['11.5'], over_12_5_rate: item.overRates['12.5'],
      sample_size: item.sampleSize }));
    await this.pool.query(
      `INSERT INTO league_corner_baselines(competition_id,season,avg_home_corners,avg_away_corners,avg_total_corners,stddev_total_corners,
       variance_total_corners,over_7_5_rate,over_8_5_rate,over_9_5_rate,over_10_5_rate,over_11_5_rate,over_12_5_rate,sample_size)
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(competition_id uuid,season text,avg_home_corners numeric,
       avg_away_corners numeric,avg_total_corners numeric,stddev_total_corners numeric,variance_total_corners numeric,
       over_7_5_rate numeric,over_8_5_rate numeric,over_9_5_rate numeric,over_10_5_rate numeric,over_11_5_rate numeric,
       over_12_5_rate numeric,sample_size integer)
       ON CONFLICT(competition_id,season) DO UPDATE SET avg_home_corners=excluded.avg_home_corners,avg_away_corners=excluded.avg_away_corners,
       avg_total_corners=excluded.avg_total_corners,stddev_total_corners=excluded.stddev_total_corners,variance_total_corners=excluded.variance_total_corners,
       over_7_5_rate=excluded.over_7_5_rate,over_8_5_rate=excluded.over_8_5_rate,over_9_5_rate=excluded.over_9_5_rate,
       over_10_5_rate=excluded.over_10_5_rate,over_11_5_rate=excluded.over_11_5_rate,over_12_5_rate=excluded.over_12_5_rate,
       sample_size=excluded.sample_size,calculated_at=now()`,
      [JSON.stringify(payload)]);
  }

  async upcoming(date: string) {
    return (await this.pool.query(
      `SELECT m.id,m.league_id competition_id,m.home_team_id,m.away_team_id,m.kickoff_at,m.season,
       ht.name home_team,at.name away_team,l.name competition FROM matches m JOIN teams ht ON ht.id=m.home_team_id
       JOIN teams at ON at.id=m.away_team_id JOIN leagues l ON l.id=m.league_id
       WHERE (m.kickoff_at AT TIME ZONE 'Europe/Istanbul')::date=$1::date AND m.status='scheduled' ORDER BY m.kickoff_at`, [date])).rows;
  }

  async saveAnalysis(matchId: string, analysis: CornerAnalysis, config: CornerModelConfig, hash: string) {
    await this.pool.query(`INSERT INTO corner_model_versions(model_version,config_hash,config) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
      [config.modelVersion, hash, JSON.stringify(config)]);
    const inserted = await this.pool.query(
      `INSERT INTO corner_analyses(match_id,model_version,config_hash,expected_home_corners,expected_away_corners,expected_total_corners,
       probabilities,distribution,data_quality_score,data_quality_status,analysis_eligible,model_confidence,sample,calculation_details)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb) ON CONFLICT DO NOTHING`,
      [matchId,config.modelVersion,hash,analysis.expectedHomeCorners,analysis.expectedAwayCorners,analysis.expectedTotalCorners,
        JSON.stringify(analysis.probabilities),analysis.distribution,analysis.dataQuality.score,analysis.dataQuality.status,
        analysis.dataQuality.analysisEligible,analysis.modelConfidence,JSON.stringify(analysis.sample),JSON.stringify(analysis.calculationDetails)]);
    return (inserted.rowCount ?? 0) > 0;
  }

  async upcomingRange(from: Date, to: Date, competitions: readonly string[]) {
    const result = await this.pool.query(`SELECT m.id,m.status,m.league_id competition_id,m.home_team_id,m.away_team_id,
      m.kickoff_at,m.season,l.name competition FROM matches m JOIN leagues l ON l.id=m.league_id
      WHERE m.status='scheduled' AND m.kickoff_at>$1 AND m.kickoff_at<=$2 AND m.kickoff_at>now()
      ORDER BY m.kickoff_at,m.id`, [from,to]);
    return result.rows.filter((row) => isCompetitionConfigured(String(row.competition), competitions));
  }

  async saveBacktest(report: unknown, config: CornerModelConfig, hash: string) {
    await this.pool.query(`INSERT INTO corner_model_versions(model_version,config_hash,config) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
      [config.modelVersion, hash, JSON.stringify(config)]);
    await this.pool.query(`INSERT INTO corner_backtests(model_version,config_hash,report) VALUES($1,$2,$3::jsonb)`,
      [config.modelVersion,hash,JSON.stringify(report)]);
  }
}
