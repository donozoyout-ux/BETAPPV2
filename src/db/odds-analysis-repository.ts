import { defaultConfig } from '../odds-analysis/config.js';
import { analyzeOdds } from '../odds-analysis/engine.js';
import type { AnalysisConfig, CornerMarketComparison, OddsAnalysis, OddsSnapshot } from '../odds-analysis/types.js';
import type { DatabasePool } from './pool.js';

type MatchRow = { id: string; kickoff_at: Date; home_score: number | null; away_score: number | null };

function snapshots(rows: Array<Record<string, unknown>>): OddsSnapshot[] {
  return rows.map((row) => ({
    matchId: String(row.match_id), provider: String(row.provider), marketType: String(row.market_type),
    marketName: String(row.market_name), line: row.line == null ? null : Number(row.line),
    selection: String(row.selection), oddsDecimal: Number(row.odds_decimal), capturedAt: new Date(String(row.captured_at)),
  }));
}

function cornerComparison(row: Record<string, unknown> | undefined): CornerMarketComparison | undefined {
  if (!row) return undefined;
  return { qualityGrade: String(row.data_quality_status) as CornerMarketComparison['qualityGrade'],
    probabilities: row.probabilities as CornerMarketComparison['probabilities'] };
}

export class OddsAnalysisRepository {
  constructor(private readonly pool: DatabasePool) {}

  async analyzeAndSave(matchId: string, generatedAt = new Date(), config: AnalysisConfig = defaultConfig) {
    const [matchResult, snapshotResult, cornerResult] = await Promise.all([
      this.pool.query<MatchRow>('SELECT id,kickoff_at,home_score,away_score FROM matches WHERE id=$1', [matchId]),
      this.pool.query(`SELECT match_id,provider,market_type,market_name,line,selection,odds_decimal,captured_at
        FROM odds_snapshots WHERE match_id=$1 ORDER BY captured_at,id`, [matchId]),
      this.pool.query(`SELECT probabilities,data_quality_status FROM corner_analyses
        WHERE match_id=$1 ORDER BY created_at DESC LIMIT 1`, [matchId]),
    ]);
    const match = matchResult.rows[0];
    if (!match) return null;
    const comparison = cornerComparison(cornerResult.rows[0]);
    const analysis = analyzeOdds(match.id, new Date(match.kickoff_at), snapshots(snapshotResult.rows), {
      config, generatedAt, ...(comparison ? { cornerComparison: comparison } : {}),
    });
    const inserted = await this.save(analysis, config);
    return { analysis, inserted };
  }

  async save(analysis: OddsAnalysis, config: AnalysisConfig = defaultConfig): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO odds_analysis_model_versions(model_version,config_hash,config)
        VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
      [analysis.modelVersion, analysis.configHash, JSON.stringify(config)]);
      const run = await client.query<{ id: string }>(`INSERT INTO odds_analysis_runs(match_id,model_version,config_hash,input_hash,
        generated_at,data_quality_score,data_quality_grade,confidence_score,confidence_grade,analysis_eligible,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        ON CONFLICT(match_id,model_version,config_hash,input_hash) DO NOTHING RETURNING id`,
      [analysis.matchId,analysis.modelVersion,analysis.configHash,analysis.inputHash,analysis.generatedAt,
        analysis.dataQuality.score,analysis.dataQuality.grade,analysis.modelConfidence.score,analysis.modelConfidence.grade,
        analysis.analysisEligible,JSON.stringify(analysis.metadata)]);
      const runId = run.rows[0]?.id;
      if (!runId) {
        await client.query('COMMIT');
        return false;
      }
      for (const item of analysis.items) {
        await client.query(`INSERT INTO odds_analysis_items(run_id,market_type,market_name,line,selection,opening_odds,
          current_odds,highest_odds,lowest_odds,snapshot_count,opening_fair_probability,current_fair_probability,
          probability_delta_pp,raw_odds_movement_percent,bookmaker_count,agreeing_bookmaker_count,
          disagreeing_bookmaker_count,movement_agreement_ratio,probability_dispersion,odds_dispersion,movement_class,
          score,score_components,data_quality_score,data_quality_grade,confidence_score,confidence_grade,
          analysis_eligible,model_market_gap_pp,reasons,warnings)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,
          $24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb)`,
        [runId,item.marketType,item.marketName,item.line,item.selection,item.openingOdds,item.currentOdds,item.highestOdds,
          item.lowestOdds,item.snapshotCount,item.openingFairProbability,item.currentFairProbability,item.probabilityDeltaPp,
          item.rawOddsMovementPercent,item.bookmakerCount,item.agreeingBookmakerCount,item.disagreeingBookmakerCount,
          item.movementAgreementRatio,item.probabilityDispersion,item.oddsDispersion,item.movementClass,item.score,
          JSON.stringify(item.scoreComponents),item.dataQuality.score,item.dataQuality.grade,item.modelConfidence.score,
          item.modelConfidence.grade,item.analysisEligible,item.modelMarketGapPp,JSON.stringify(item.reasons),JSON.stringify(item.warnings)]);
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async analyzeUpcoming(config: AnalysisConfig = defaultConfig): Promise<{ analyzed: number; inserted: number; failures: number }> {
    const result = await this.pool.query<{ id: string }>(`SELECT DISTINCT m.id FROM matches m
      JOIN odds_snapshots os ON os.match_id=m.id WHERE m.kickoff_at>now() AND m.status='scheduled' ORDER BY m.id`);
    let inserted = 0;
    let failures = 0;
    for (const row of result.rows) {
      try {
        const saved = await this.analyzeAndSave(row.id, new Date(), config);
        if (saved?.inserted) inserted += 1;
      } catch {
        failures += 1;
      }
    }
    return { analyzed: result.rows.length, inserted, failures };
  }

  async upcoming() {
    return (await this.pool.query(`SELECT r.*,m.kickoff_at,l.name league,ht.name home_team,at.name away_team,
      COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.score DESC) FILTER(WHERE i.id IS NOT NULL),'[]'::jsonb) items
      FROM odds_analysis_runs r JOIN matches m ON m.id=r.match_id JOIN leagues l ON l.id=m.league_id
      JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      LEFT JOIN odds_analysis_items i ON i.run_id=r.id
      WHERE m.kickoff_at>=now() AND NOT EXISTS(SELECT 1 FROM odds_analysis_runs newer
        WHERE newer.match_id=r.match_id AND newer.model_version=r.model_version
        AND (newer.created_at,newer.id)>(r.created_at,r.id))
      GROUP BY r.id,m.kickoff_at,l.name,ht.name,at.name ORDER BY m.kickoff_at`)).rows;
  }

  async byMatch(matchId: string) {
    const run = await this.pool.query(`SELECT r.*,m.kickoff_at,l.name league,ht.name home_team,at.name away_team
      FROM odds_analysis_runs r JOIN matches m ON m.id=r.match_id JOIN leagues l ON l.id=m.league_id
      JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      WHERE r.match_id=$1 ORDER BY r.created_at DESC LIMIT 1`, [matchId]);
    const row = run.rows[0];
    if (!row) return null;
    const items = await this.pool.query('SELECT * FROM odds_analysis_items WHERE run_id=$1 ORDER BY market_type,market_name,line,selection', [row.id]);
    return { ...row, items: items.rows };
  }

  async matchesForDate(date: string) {
    return (await this.pool.query(`SELECT m.id,m.kickoff_at,l.name league,ht.name home_team,at.name away_team
      FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id
      JOIN teams at ON at.id=m.away_team_id WHERE (m.kickoff_at AT TIME ZONE 'Europe/Istanbul')::date=$1::date
      AND EXISTS(SELECT 1 FROM odds_snapshots os WHERE os.match_id=m.id) ORDER BY m.kickoff_at`, [date])).rows;
  }

  async backtestDataset() {
    const matches = await this.pool.query<MatchRow>(`SELECT id,kickoff_at,home_score,away_score FROM matches
      WHERE status='finished' AND home_score IS NOT NULL AND away_score IS NOT NULL ORDER BY kickoff_at`);
    const odds = await this.pool.query(`SELECT match_id,provider,market_type,market_name,line,selection,odds_decimal,captured_at
      FROM odds_snapshots WHERE match_id=ANY($1::uuid[]) ORDER BY match_id,captured_at,id`, [matches.rows.map((row) => row.id)]);
    const grouped = new Map<string, OddsSnapshot[]>();
    for (const snapshot of snapshots(odds.rows)) grouped.set(snapshot.matchId, [...(grouped.get(snapshot.matchId) ?? []), snapshot]);
    return matches.rows.map((match) => ({ matchId: match.id, kickoffAt: new Date(match.kickoff_at),
      homeScore: Number(match.home_score), awayScore: Number(match.away_score), snapshots: grouped.get(match.id) ?? [] }));
  }

  async saveBacktest(report: unknown, config: AnalysisConfig, hash: string) {
    await this.pool.query(`INSERT INTO odds_analysis_model_versions(model_version,config_hash,config)
      VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`, [config.modelVersion,hash,JSON.stringify(config)]);
    await this.pool.query('INSERT INTO odds_analysis_backtests(model_version,config_hash,report) VALUES($1,$2,$3::jsonb)',
      [config.modelVersion,hash,JSON.stringify(report)]);
  }
}
