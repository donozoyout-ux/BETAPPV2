import { createHash } from 'node:crypto';
import { analyzeOdds } from '../odds-analysis/engine.js';
import type { AnalysisItem, OddsSnapshot } from '../odds-analysis/types.js';
import type { DatabasePool } from '../db/pool.js';
import { predictionConfig, predictionConfigHash, type PredictionConfig } from './config.js';
import { evaluatePrediction, lockWindowState } from './engine.js';
import { buildPerformance, runPredictionBacktestFromSnapshots, type PerformanceRecord } from './history.js';
import { referencePaperReturn, settlePrediction } from './settlement.js';
import { evaluateSelfAudit, selfAuditConfig, type SelfAuditConfig, type SelfAuditRecord, type SelfAuditStatus } from './self-audit.js';
import { evaluateSegmentSelfAudits, segmentKeysFor, selfAuditV2Config,
  type SegmentSelfAuditRecord } from './self-audit-v2.js';
import { evaluateRootCauses, selfAuditV3Config,
  type RootCauseConfig, type RootCauseRecord, type RootCauseStatus } from './self-audit-v3.js';
import { adaptiveRuleConfigHash, adaptiveRuleEvaluationInputHash, generateAdaptiveRuleProposals, selfAuditV4Config,
  type AdaptiveRuleConfig } from './self-audit-v4.js';
import type { HistoricalExample, PredictionEvaluation, PredictionTarget, SettlementOutcome } from './types.js';

function analysisItem(row: Record<string, unknown>): AnalysisItem {
  return {
    marketType: String(row.market_type), marketName: String(row.market_name), line: row.line == null ? null : Number(row.line),
    selection: String(row.selection), openingOdds: Number(row.opening_odds), currentOdds: Number(row.current_odds),
    highestOdds: Number(row.highest_odds), lowestOdds: Number(row.lowest_odds), snapshotCount: Number(row.snapshot_count),
    openingFairProbability: Number(row.opening_fair_probability), currentFairProbability: Number(row.current_fair_probability),
    probabilityDeltaPp: Number(row.probability_delta_pp), rawOddsMovementPercent: Number(row.raw_odds_movement_percent),
    bookmakerCount: Number(row.bookmaker_count), completeStateBookmakerCount: Number(row.complete_state_bookmaker_count),
    minimumCompleteStateCount: Number(row.minimum_complete_state_count), agreeingBookmakerCount: Number(row.agreeing_bookmaker_count),
    disagreeingBookmakerCount: Number(row.disagreeing_bookmaker_count), movementAgreementRatio: Number(row.movement_agreement_ratio),
    probabilityDispersion: Number(row.probability_dispersion), oddsDispersion: Number(row.odds_dispersion),
    movementClass: String(row.movement_class) as AnalysisItem['movementClass'], score: Number(row.score),
    scoreComponents: row.score_components as AnalysisItem['scoreComponents'],
    dataQuality: { score: Number(row.data_quality_score), grade: String(row.data_quality_grade) as AnalysisItem['dataQuality']['grade'],
      analysisEligible: Boolean(row.analysis_eligible), warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [] },
    modelConfidence: { score: Number(row.confidence_score), grade: String(row.confidence_grade) as AnalysisItem['modelConfidence']['grade'] },
    analysisEligible: Boolean(row.analysis_eligible), reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    modelMarketGapPp: row.model_market_gap_pp == null ? null : Number(row.model_market_gap_pp),
  };
}

function historicalExample(row: Record<string, unknown>): HistoricalExample {
  return {
    id: String(row.id), matchId: String(row.match_id), competitionId: String(row.competition_id),
    kickoffAt: new Date(String(row.kickoff_at)), oddsInputHash: String(row.odds_input_hash),
    featureCutoffAt: new Date(String(row.feature_cutoff_at)), featureLeadMinutes: Number(row.feature_lead_minutes),
    analysisEligible: Boolean(row.analysis_eligible), dataQualityGrade: String(row.data_quality_grade) as HistoricalExample['dataQualityGrade'],
    confidenceGrade: String(row.confidence_grade) as HistoricalExample['confidenceGrade'],
    completeStateBookmakerCount: Number(row.complete_state_bookmaker_count),
    minimumCompleteStateCount: Number(row.minimum_complete_state_count),
    marketType: String(row.market_type), marketName: String(row.market_name), line: row.line == null ? null : Number(row.line),
    selection: String(row.selection), openingOdds: Number(row.opening_odds), currentOdds: Number(row.current_odds),
    openingFairProbability: Number(row.opening_fair_probability), currentFairProbability: Number(row.current_fair_probability),
    probabilityDeltaPp: Number(row.probability_delta_pp), bookmakerCount: Number(row.bookmaker_count),
    movementAgreementRatio: Number(row.movement_agreement_ratio), oddsAnalysisScore: Number(row.odds_analysis_score),
    dataQualityScore: Number(row.data_quality_score), confidenceScore: Number(row.confidence_score),
    movementClass: String(row.movement_class) as HistoricalExample['movementClass'],
    settlementResult: String(row.settlement_result) as SettlementOutcome,
    homeScore: row.home_score == null ? null : Number(row.home_score), awayScore: row.away_score == null ? null : Number(row.away_score),
    homeCorners: row.home_corners == null ? null : Number(row.home_corners), awayCorners: row.away_corners == null ? null : Number(row.away_corners),
  };
}

export class PredictionRepository {
  constructor(private readonly pool: DatabasePool) {}

  async ensureModel(config: PredictionConfig = predictionConfig) {
    await this.pool.query(`INSERT INTO prediction_model_versions(model_version,config_hash,config)
      VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`, [config.modelVersion,predictionConfigHash(config),JSON.stringify(config)]);
  }

  async loadHistoricalExamples(before?: Date, includeIneligible = false): Promise<HistoricalExample[]> {
    const result = await this.pool.query(`SELECT * FROM prediction_historical_examples
      WHERE ($1::timestamptz IS NULL OR kickoff_at<$1) AND ($2::boolean OR analysis_eligible=true)
      ORDER BY kickoff_at,id`, [before ?? null, includeIneligible]);
    return result.rows.map(historicalExample);
  }

  async loadTargets(whereSql = "m.status='scheduled' AND m.kickoff_at>now()", params: unknown[] = []): Promise<PredictionTarget[]> {
    const result = await this.pool.query(`SELECT m.id match_id,m.league_id competition_id,m.kickoff_at,
      r.input_hash odds_input_hash,COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.score DESC)
      FILTER(WHERE i.id IS NOT NULL),'[]'::jsonb) items
      FROM matches m JOIN LATERAL(SELECT * FROM odds_analysis_runs ar WHERE ar.match_id=m.id
        ORDER BY ar.created_at DESC,ar.id DESC LIMIT 1) r ON true
      LEFT JOIN odds_analysis_items i ON i.run_id=r.id WHERE ${whereSql}
      GROUP BY m.id,r.id ORDER BY m.kickoff_at`, params);
    return result.rows.map((row) => ({ matchId: row.match_id, competitionId: row.competition_id,
      kickoffAt: new Date(row.kickoff_at), oddsInputHash: row.odds_input_hash,
      oddsItems: (row.items as Array<Record<string, unknown>>).map(analysisItem) }));
  }

  async saveRun(evaluation: PredictionEvaluation, config: PredictionConfig = predictionConfig): Promise<string> {
    await this.ensureModel(config);
    const result = await this.pool.query<{ id: string }>(`INSERT INTO prediction_runs(match_id,model_version,config_hash,input_hash,
      odds_analysis_input_hash,generated_at,decision,selected_candidate,candidates,skip_reasons,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)
      ON CONFLICT(match_id,model_version,config_hash,input_hash) DO UPDATE SET input_hash=excluded.input_hash RETURNING id`,
    [evaluation.matchId,evaluation.modelVersion,evaluation.configHash,evaluation.inputHash,evaluation.oddsAnalysisInputHash,
      evaluation.generatedAt,evaluation.decision,evaluation.selectedCandidate ? JSON.stringify(evaluation.selectedCandidate) : null,
      JSON.stringify(evaluation.candidates),JSON.stringify(evaluation.skipReasons),JSON.stringify(evaluation.metadata)]);
    return result.rows[0]!.id;
  }

  async lock(evaluation: PredictionEvaluation, runId: string, lockedAt: Date, _minutesToKickoff: number,
    config: PredictionConfig = predictionConfig): Promise<boolean> {
    const minutesToKickoff = (evaluation.kickoffAt.getTime() - lockedAt.getTime()) / 60_000;
    if (!Number.isFinite(minutesToKickoff) || minutesToKickoff <= 0 || lockedAt >= evaluation.kickoffAt) return false;
    if (minutesToKickoff > config.officialWindowStartMinutes) return false;
    if (evaluation.decision === 'PREDICT' && minutesToKickoff < config.minimumLockLeadMinutes) return false;
    const item = evaluation.selectedCandidate;
    const historical = item?.historical;
    const result = await this.pool.query(`INSERT INTO prediction_journal(match_id,prediction_run_id,model_version,config_hash,
      locked_at,kickoff_at,minutes_to_kickoff,decision,market_type,market_name,line,selection,reference_odds,opening_odds,
      current_odds,current_fair_probability,probability_delta_pp,prediction_score,score_components,bookmaker_count,
      agreement_ratio,data_quality_score,data_quality_grade,confidence_score,confidence_grade,movement_class,
      historical_sample_size,historical_settled_sample_size,historical_hit_rate,historical_wilson_lower95,
      historical_wilson_upper95,historical_scope,historical_frequency_gap_pp,reasons,warnings,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,
      $26,$27,$28,$29,$30,$31,$32,$33,$34::jsonb,$35::jsonb,$36::jsonb)
      ON CONFLICT(match_id,model_version) DO NOTHING`,
    [evaluation.matchId,runId,evaluation.modelVersion,evaluation.configHash,lockedAt,evaluation.kickoffAt,minutesToKickoff,
      evaluation.decision,item?.marketType ?? null,item?.marketName ?? null,item?.line ?? null,item?.selection ?? null,
      item?.referenceOdds ?? null,item?.openingOdds ?? null,item?.currentOdds ?? null,item?.currentFairProbability ?? null,
      item?.probabilityDeltaPp ?? null,item?.predictionScore ?? null,item ? JSON.stringify(item.scoreComponents) : null,
      item?.bookmakerCount ?? null,item?.agreementRatio ?? null,item?.dataQualityScore ?? null,item?.dataQualityGrade ?? null,
      item?.confidenceScore ?? null,item?.confidenceGrade ?? null,item?.movementClass ?? null,historical?.sampleSize ?? 0,
      historical?.settledSampleSize ?? 0,historical?.historicalHitRate ?? null,historical?.wilsonLower95 ?? null,
      historical?.wilsonUpper95 ?? null,historical?.scope ?? null,historical?.historicalFrequencyGapPp ?? null,
      JSON.stringify(item?.reasons ?? evaluation.skipReasons),JSON.stringify(item?.warnings ?? []),JSON.stringify(evaluation.metadata)]);
    return (result.rowCount ?? 0) === 1;
  }

  private async historicalRows(config: PredictionConfig, incremental: boolean) {
    return this.pool.query(`SELECT m.id,m.league_id,m.kickoff_at,m.status,m.home_score,m.away_score,
      h.home_corners,h.away_corners,COALESCE(jsonb_agg(to_jsonb(os) ORDER BY os.captured_at,os.id)
      FILTER(WHERE os.id IS NOT NULL),'[]'::jsonb) snapshots
      FROM matches m JOIN odds_snapshots os ON os.match_id=m.id
      LEFT JOIN historical_match_stats h ON h.match_id=m.id
      WHERE m.status IN('finished','cancelled') AND (NOT $1::boolean OR NOT EXISTS(
        SELECT 1 FROM prediction_historical_refreshes pr WHERE pr.match_id=m.id
          AND pr.model_version=$2 AND pr.config_hash=$3))
      GROUP BY m.id,h.home_corners,h.away_corners ORDER BY m.kickoff_at`,
    [incremental, config.modelVersion, predictionConfigHash(config)]);
  }

  private async createHistoricalExamples(rows: Array<Record<string, unknown>>, config: PredictionConfig) {
    let examples = 0;
    let usableMatches = 0;
    let rejectedIneligible = 0;
    for (const row of rows) {
      const kickoffAt = new Date(String(row.kickoff_at));
      const featureCutoffAt = new Date(kickoffAt.getTime() - config.officialWindowStartMinutes * 60_000);
      await this.ensureModel(config);
      const snapshots = (row.snapshots as Array<Record<string, unknown>>).map((item): OddsSnapshot => ({
        matchId: String(row.id), provider: String(item.provider), marketType: String(item.market_type), marketName: String(item.market_name),
        line: item.line == null ? null : Number(item.line), selection: String(item.selection), oddsDecimal: Number(item.odds_decimal),
        capturedAt: new Date(String(item.captured_at)),
      }));
      const analysis = analyzeOdds(String(row.id), kickoffAt, snapshots, { generatedAt: featureCutoffAt });
      let matchExamples = 0;
      let matchRejectedIneligible = 0;
      for (const item of analysis.items) {
        if (!item.analysisEligible) { rejectedIneligible += 1; matchRejectedIneligible += 1; continue; }
        const settled = settlePrediction({ marketType: item.marketType, marketName: item.marketName, line: item.line,
          selection: item.selection, matchStatus: String(row.status),
          homeScore: row.home_score == null ? null : Number(row.home_score), awayScore: row.away_score == null ? null : Number(row.away_score),
          homeCorners: row.home_corners == null ? null : Number(row.home_corners), awayCorners: row.away_corners == null ? null : Number(row.away_corners) });
        if (!settled.outcome) continue;
        const saved = await this.pool.query(`INSERT INTO prediction_historical_examples(match_id,competition_id,kickoff_at,
          model_version,config_hash,odds_input_hash,feature_cutoff_at,feature_lead_minutes,analysis_eligible,data_quality_grade,
          confidence_grade,complete_state_bookmaker_count,minimum_complete_state_count,market_type,market_name,line,selection,opening_odds,current_odds,
          opening_fair_probability,current_fair_probability,probability_delta_pp,bookmaker_count,movement_agreement_ratio,
          odds_analysis_score,data_quality_score,confidence_score,movement_class,settlement_result,home_score,away_score,
          home_corners,away_corners) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33) ON CONFLICT DO NOTHING`,
        [row.id,row.league_id,kickoffAt,config.modelVersion,predictionConfigHash(config),analysis.inputHash,featureCutoffAt,
          config.officialWindowStartMinutes,true,item.dataQuality.grade,item.modelConfidence.grade,item.completeStateBookmakerCount,
          item.minimumCompleteStateCount,item.marketType,item.marketName,item.line,item.selection,item.openingOdds,item.currentOdds,item.openingFairProbability,
          item.currentFairProbability,item.probabilityDeltaPp,item.bookmakerCount,item.movementAgreementRatio,item.score,
          item.dataQuality.score,item.modelConfidence.score,item.movementClass,settled.outcome,row.home_score,row.away_score,
          row.home_corners,row.away_corners]);
        matchExamples += saved.rowCount ?? 0;
      }
      if (analysis.items.length) usableMatches += 1;
      examples += matchExamples;
      await this.pool.query(`INSERT INTO prediction_historical_refreshes(match_id,model_version,config_hash,examples_inserted,rejected_ineligible)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(match_id,model_version,config_hash) DO NOTHING`,
      [row.id, config.modelVersion, predictionConfigHash(config), matchExamples, matchRejectedIneligible]);
    }
    return { examples, usableMatches, rejectedIneligible };
  }

  async backfillHistorical(config: PredictionConfig = predictionConfig) {
    await this.ensureModel(config);
    const result = await this.historicalRows(config, false);
    const created = await this.createHistoricalExamples(result.rows, config);
    const totals = await this.pool.query('SELECT count(DISTINCT match_id) matches,count(*) examples FROM prediction_historical_examples');
    return { inspectedMatches: result.rows.length, usableMatches: created.usableMatches, insertedExamples: created.examples,
      rejectedIneligible: created.rejectedIneligible,
      historicalMatchesAvailable: Number(totals.rows[0].matches), historicalExamplesAvailable: Number(totals.rows[0].examples) };
  }

  async refreshHistoricalIncremental(config: PredictionConfig = predictionConfig) {
    await this.ensureModel(config);
    const result = await this.historicalRows(config, true);
    const created = await this.createHistoricalExamples(result.rows, config);
    return { inspectedMatches: result.rows.length, insertedExamples: created.examples,
      rejectedIneligible: created.rejectedIneligible, usableMatches: created.usableMatches };
  }

  async settlePending() {
    const result = await this.pool.query(`SELECT j.*,m.status,m.home_score,m.away_score,h.home_corners,h.away_corners
      FROM prediction_journal j JOIN matches m ON m.id=j.match_id
      LEFT JOIN historical_match_stats h ON h.match_id=m.id LEFT JOIN prediction_settlements s ON s.prediction_journal_id=j.id
      WHERE j.decision='PREDICT' AND s.id IS NULL AND m.status IN('finished','cancelled')`);
    let settled = 0;
    let unavailable = 0;
    for (const row of result.rows) {
      const resolution = settlePrediction({ marketType: row.market_type, marketName: row.market_name, line: row.line == null ? null : Number(row.line),
        selection: row.selection, matchStatus: row.status, homeScore: row.home_score, awayScore: row.away_score,
        homeCorners: row.home_corners, awayCorners: row.away_corners });
      if (!resolution.outcome) { unavailable += 1; continue; }
      const saved = await this.pool.query(`INSERT INTO prediction_settlements(prediction_journal_id,outcome,home_score,
        away_score,home_corners,away_corners,reference_paper_return,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT(prediction_journal_id) DO NOTHING`, [row.id,resolution.outcome,row.home_score,row.away_score,
        row.home_corners,row.away_corners,referencePaperReturn(resolution.outcome,Number(row.reference_odds)),JSON.stringify({ reason: resolution.reason })]);
      settled += saved.rowCount ?? 0;
    }
    return { candidates: result.rows.length, settled, unavailable };
  }

  async runSelfAudit(modelConfig: PredictionConfig = predictionConfig, auditConfig: SelfAuditConfig = selfAuditConfig) {
    const result = await this.pool.query(`SELECT s.id settlement_id,s.settled_at,s.outcome,s.reference_paper_return,
      j.historical_hit_rate FROM prediction_settlements s
      JOIN prediction_journal j ON j.id=s.prediction_journal_id
      WHERE j.decision='PREDICT' AND j.model_version=$1 AND j.config_hash=$2
      ORDER BY s.settled_at DESC,s.id DESC`, [modelConfig.modelVersion,predictionConfigHash(modelConfig)]);
    const records = result.rows.map((row): SelfAuditRecord => ({
      settlementId: String(row.settlement_id),
      settledAt: new Date(String(row.settled_at)),
      outcome: String(row.outcome) as SettlementOutcome,
      referencePaperReturn: Number(row.reference_paper_return),
      historicalHitRate: row.historical_hit_rate == null ? null : Number(row.historical_hit_rate),
    }));
    const report = evaluateSelfAudit(records, new Date(), auditConfig);
    const predictionConfigHashValue = predictionConfigHash(modelConfig);
    const inserted = await this.pool.query<{ id: string }>(`INSERT INTO prediction_self_audits(
      audit_version,model_version,prediction_config_hash,config_hash,input_hash,evaluated_at,status,settled_sample_size,binary_sample_size,
      recent_sample_size,recent_binary_sample_size,recent_positive_rate,recent_reference_paper_roi,calibration_mae,
      calibration_sample_size,loss_streak,pause_until,reasons,metrics)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb)
      ON CONFLICT(audit_version,model_version,prediction_config_hash,config_hash,input_hash) DO NOTHING RETURNING id`,
    [report.version,modelConfig.modelVersion,predictionConfigHashValue,report.configHash,report.inputHash,
      report.evaluatedAt,report.status,report.settledSampleSize,report.binarySampleSize,report.recentSampleSize,
      report.recentBinarySampleSize,report.recentPositiveRate,report.recentReferencePaperRoi,report.calibrationMae,
      report.calibrationSampleSize,report.lossStreak,report.pauseUntil,JSON.stringify(report.reasons),JSON.stringify(report.metrics)]);
    void inserted;
    const persisted = await this.latestSelfAudit(modelConfig);
    if (!persisted) throw new Error('SELF_AUDIT_V1 persistence failed');
    return persisted;
  }

  async latestSelfAudit(modelConfig: PredictionConfig = predictionConfig) {
    const result = await this.pool.query(`SELECT id,audit_version,model_version,prediction_config_hash,config_hash,input_hash,
      evaluated_at,status,settled_sample_size,binary_sample_size,recent_sample_size,recent_binary_sample_size,recent_positive_rate,
      recent_reference_paper_roi,calibration_mae,calibration_sample_size,loss_streak,pause_until,reasons,metrics
      FROM prediction_self_audits WHERE model_version=$1 AND prediction_config_hash=$2
      ORDER BY evaluated_at DESC,created_at DESC,id DESC LIMIT 1`,
    [modelConfig.modelVersion,predictionConfigHash(modelConfig)]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id), version: String(row.audit_version), modelVersion: String(row.model_version),
      predictionConfigHash: String(row.prediction_config_hash), configHash: String(row.config_hash), inputHash: String(row.input_hash),
      evaluatedAt: new Date(String(row.evaluated_at)), status: String(row.status) as SelfAuditStatus,
      settledSampleSize: Number(row.settled_sample_size), binarySampleSize: Number(row.binary_sample_size),
      recentSampleSize: Number(row.recent_sample_size), recentBinarySampleSize: Number(row.recent_binary_sample_size),
      recentPositiveRate: row.recent_positive_rate == null ? null : Number(row.recent_positive_rate),
      recentReferencePaperRoi: row.recent_reference_paper_roi == null ? null : Number(row.recent_reference_paper_roi),
      calibrationMae: row.calibration_mae == null ? null : Number(row.calibration_mae),
      calibrationSampleSize: Number(row.calibration_sample_size), lossStreak: Number(row.loss_streak),
      pauseUntil: row.pause_until == null ? null : new Date(String(row.pause_until)),
      guardActive: row.pause_until != null && new Date(String(row.pause_until)) > new Date(),
      reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
      metrics: row.metrics as Record<string, number>,
    };
  }

  async runSegmentSelfAudit(modelConfig: PredictionConfig = predictionConfig, auditConfig: SelfAuditConfig = selfAuditV2Config) {
    const result = await this.pool.query(`SELECT s.id settlement_id,s.settled_at,s.outcome,s.reference_paper_return,
      j.historical_hit_rate,j.market_type,m.league_id competition_id,l.name competition_name
      FROM prediction_settlements s JOIN prediction_journal j ON j.id=s.prediction_journal_id
      JOIN matches m ON m.id=j.match_id JOIN leagues l ON l.id=m.league_id
      WHERE j.decision='PREDICT' AND j.model_version=$1 AND j.config_hash=$2 AND j.market_type IS NOT NULL
      ORDER BY s.settled_at DESC,s.id DESC`, [modelConfig.modelVersion,predictionConfigHash(modelConfig)]);
    const records = result.rows.map((row): SegmentSelfAuditRecord => ({
      settlementId: String(row.settlement_id),
      settledAt: new Date(String(row.settled_at)),
      outcome: String(row.outcome) as SettlementOutcome,
      referencePaperReturn: Number(row.reference_paper_return),
      historicalHitRate: row.historical_hit_rate == null ? null : Number(row.historical_hit_rate),
      competitionId: String(row.competition_id),
      competitionName: String(row.competition_name),
      marketType: String(row.market_type),
    }));
    const reports = evaluateSegmentSelfAudits(records, new Date(), auditConfig);
    const predictionConfigHashValue = predictionConfigHash(modelConfig);
    for (const report of reports) {
      await this.pool.query(`INSERT INTO prediction_self_audit_segments(
        audit_version,model_version,prediction_config_hash,config_hash,input_hash,scope_type,segment_key,
        competition_id,competition_name,market_type,evaluated_at,status,settled_sample_size,binary_sample_size,
        recent_sample_size,recent_binary_sample_size,recent_positive_rate,recent_reference_paper_roi,calibration_mae,
        calibration_sample_size,loss_streak,pause_until,reasons,metrics)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24::jsonb)
        ON CONFLICT(audit_version,model_version,prediction_config_hash,config_hash,segment_key,input_hash) DO NOTHING`,
      [report.version,modelConfig.modelVersion,predictionConfigHashValue,report.configHash,report.inputHash,report.scopeType,
        report.segmentKey,report.competitionId,report.competitionName,report.marketType,report.evaluatedAt,report.status,
        report.settledSampleSize,report.binarySampleSize,report.recentSampleSize,report.recentBinarySampleSize,
        report.recentPositiveRate,report.recentReferencePaperRoi,report.calibrationMae,report.calibrationSampleSize,
        report.lossStreak,report.pauseUntil,JSON.stringify(report.reasons),JSON.stringify(report.metrics)]);
    }
    return this.latestSegmentSelfAudits(modelConfig);
  }

  async latestSegmentSelfAudits(modelConfig: PredictionConfig = predictionConfig) {
    const result = await this.pool.query(`SELECT DISTINCT ON(segment_key)
      id,audit_version,model_version,prediction_config_hash,config_hash,input_hash,scope_type,segment_key,
      competition_id,competition_name,market_type,evaluated_at,status,settled_sample_size,binary_sample_size,
      recent_sample_size,recent_binary_sample_size,recent_positive_rate,recent_reference_paper_roi,calibration_mae,
      calibration_sample_size,loss_streak,pause_until,reasons,metrics
      FROM prediction_self_audit_segments
      WHERE model_version=$1 AND prediction_config_hash=$2
      ORDER BY segment_key,evaluated_at DESC,created_at DESC,id DESC`,
    [modelConfig.modelVersion,predictionConfigHash(modelConfig)]);
    const now = new Date();
    const severity = (status: string, guardActive: boolean) =>
      status === 'PAUSED' && guardActive ? 0 : status === 'WATCH' ? 1 : status === 'PAUSED' ? 2
      : status === 'INSUFFICIENT_DATA' ? 3 : 4;
    return result.rows.map((row) => {
      const pauseUntil = row.pause_until == null ? null : new Date(String(row.pause_until));
      const guardActive = pauseUntil != null && pauseUntil > now;
      return {
        id: String(row.id), version: String(row.audit_version), modelVersion: String(row.model_version),
        predictionConfigHash: String(row.prediction_config_hash), configHash: String(row.config_hash),
        inputHash: String(row.input_hash), scopeType: String(row.scope_type),
        segmentKey: String(row.segment_key), competitionId: row.competition_id == null ? null : String(row.competition_id),
        competitionName: row.competition_name == null ? null : String(row.competition_name),
        marketType: row.market_type == null ? null : String(row.market_type),
        evaluatedAt: new Date(String(row.evaluated_at)), status: String(row.status) as SelfAuditStatus,
        settledSampleSize: Number(row.settled_sample_size), binarySampleSize: Number(row.binary_sample_size),
        recentSampleSize: Number(row.recent_sample_size), recentBinarySampleSize: Number(row.recent_binary_sample_size),
        recentPositiveRate: row.recent_positive_rate == null ? null : Number(row.recent_positive_rate),
        recentReferencePaperRoi: row.recent_reference_paper_roi == null ? null : Number(row.recent_reference_paper_roi),
        calibrationMae: row.calibration_mae == null ? null : Number(row.calibration_mae),
        calibrationSampleSize: Number(row.calibration_sample_size), lossStreak: Number(row.loss_streak),
        pauseUntil, guardActive, reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
        metrics: row.metrics as Record<string, number>,
      };
    }).sort((a, b) => severity(a.status, a.guardActive) - severity(b.status, b.guardActive)
      || b.recentSampleSize - a.recentSampleSize || a.segmentKey.localeCompare(b.segmentKey));
  }

  private async rootCauseRecords(modelConfig: PredictionConfig = predictionConfig): Promise<RootCauseRecord[]> {
    const result = await this.pool.query(`SELECT s.id settlement_id,s.settled_at,s.outcome,s.reference_paper_return,
      j.historical_hit_rate,j.prediction_score,j.bookmaker_count,j.historical_settled_sample_size,
      j.data_quality_grade,j.confidence_grade,j.movement_class,j.agreement_ratio
      FROM prediction_settlements s JOIN prediction_journal j ON j.id=s.prediction_journal_id
      WHERE j.decision='PREDICT' AND j.model_version=$1 AND j.config_hash=$2
      ORDER BY s.settled_at DESC,s.id DESC`, [modelConfig.modelVersion,predictionConfigHash(modelConfig)]);
    return result.rows.map((row): RootCauseRecord => ({
      settlementId: String(row.settlement_id),
      settledAt: new Date(String(row.settled_at)),
      outcome: String(row.outcome) as SettlementOutcome,
      referencePaperReturn: Number(row.reference_paper_return),
      historicalHitRate: row.historical_hit_rate == null ? null : Number(row.historical_hit_rate),
      predictionScore: row.prediction_score == null ? null : Number(row.prediction_score),
      bookmakerCount: row.bookmaker_count == null ? null : Number(row.bookmaker_count),
      historicalSampleSize: Number(row.historical_settled_sample_size ?? 0),
      dataQualityGrade: row.data_quality_grade == null ? null : String(row.data_quality_grade),
      confidenceGrade: row.confidence_grade == null ? null : String(row.confidence_grade),
      movementClass: row.movement_class == null ? null : String(row.movement_class),
      agreementRatio: row.agreement_ratio == null ? null : Number(row.agreement_ratio),
    }));
  }

  async runRootCauseAudit(modelConfig: PredictionConfig = predictionConfig, auditConfig: RootCauseConfig = selfAuditV3Config) {
    const records = await this.rootCauseRecords(modelConfig);
    const reports = evaluateRootCauses(records, new Date(), auditConfig);
    const predictionConfigHashValue = predictionConfigHash(modelConfig);
    for (const report of reports) {
      await this.pool.query(`INSERT INTO prediction_self_audit_factors(
        audit_version,model_version,prediction_config_hash,config_hash,input_hash,dimension,bucket_key,bucket_label,
        evaluated_at,status,settled_sample_size,binary_sample_size,positive_rate,reference_paper_roi,calibration_gap,
        calibration_sample_size,baseline_binary_sample_size,baseline_positive_rate,baseline_reference_paper_roi,
        positive_rate_gap,reference_paper_roi_gap,evidence_strength,root_cause_score,reasons)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb)
        ON CONFLICT(audit_version,model_version,prediction_config_hash,config_hash,dimension,bucket_key,input_hash) DO NOTHING`,
      [report.version,modelConfig.modelVersion,predictionConfigHashValue,report.configHash,report.inputHash,
        report.dimension,report.bucketKey,report.bucketLabel,report.evaluatedAt,report.status,report.settledSampleSize,
        report.binarySampleSize,report.positiveRate,report.referencePaperRoi,report.calibrationGap,report.calibrationSampleSize,
        report.baselineBinarySampleSize,report.baselinePositiveRate,report.baselineReferencePaperRoi,report.positiveRateGap,
        report.referencePaperRoiGap,report.evidenceStrength,report.rootCauseScore,JSON.stringify(report.reasons)]);
    }
    return this.latestRootCauseAudits(modelConfig);
  }

  async latestRootCauseAudits(modelConfig: PredictionConfig = predictionConfig) {
    const result = await this.pool.query(`SELECT DISTINCT ON(dimension,bucket_key)
      id,audit_version,model_version,prediction_config_hash,config_hash,input_hash,dimension,bucket_key,bucket_label,
      evaluated_at,status,settled_sample_size,binary_sample_size,positive_rate,reference_paper_roi,calibration_gap,
      calibration_sample_size,baseline_binary_sample_size,baseline_positive_rate,baseline_reference_paper_roi,
      positive_rate_gap,reference_paper_roi_gap,evidence_strength,root_cause_score,reasons
      FROM prediction_self_audit_factors
      WHERE model_version=$1 AND prediction_config_hash=$2
      ORDER BY dimension,bucket_key,evaluated_at DESC,created_at DESC,id DESC`,
    [modelConfig.modelVersion,predictionConfigHash(modelConfig)]);
    const severity = (status: RootCauseStatus) =>
      status === 'HIGH_RISK' ? 0 : status === 'WATCH' ? 1 : status === 'HEALTHY' ? 2 : 3;
    return result.rows.map((row) => ({
      id: String(row.id), version: String(row.audit_version), modelVersion: String(row.model_version),
      predictionConfigHash: String(row.prediction_config_hash), configHash: String(row.config_hash),
      inputHash: String(row.input_hash), dimension: String(row.dimension), bucketKey: String(row.bucket_key),
      bucketLabel: String(row.bucket_label), evaluatedAt: new Date(String(row.evaluated_at)),
      status: String(row.status) as RootCauseStatus, settledSampleSize: Number(row.settled_sample_size),
      binarySampleSize: Number(row.binary_sample_size), positiveRate: row.positive_rate == null ? null : Number(row.positive_rate),
      referencePaperRoi: row.reference_paper_roi == null ? null : Number(row.reference_paper_roi),
      calibrationGap: row.calibration_gap == null ? null : Number(row.calibration_gap),
      calibrationSampleSize: Number(row.calibration_sample_size), baselineBinarySampleSize: Number(row.baseline_binary_sample_size),
      baselinePositiveRate: row.baseline_positive_rate == null ? null : Number(row.baseline_positive_rate),
      baselineReferencePaperRoi: row.baseline_reference_paper_roi == null ? null : Number(row.baseline_reference_paper_roi),
      positiveRateGap: row.positive_rate_gap == null ? null : Number(row.positive_rate_gap),
      referencePaperRoiGap: row.reference_paper_roi_gap == null ? null : Number(row.reference_paper_roi_gap),
      evidenceStrength: Number(row.evidence_strength), rootCauseScore: Number(row.root_cause_score),
      reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    })).sort((a, b) => severity(a.status) - severity(b.status)
      || b.rootCauseScore - a.rootCauseScore || b.binarySampleSize - a.binarySampleSize
      || a.bucketLabel.localeCompare(b.bucketLabel));
  }

  async runAdaptiveRuleProposals(
    modelConfig: PredictionConfig = predictionConfig,
    auditConfig: AdaptiveRuleConfig = selfAuditV4Config,
  ) {
    const records = await this.rootCauseRecords(modelConfig);
    const evaluatedAt = new Date();
    const proposals = generateAdaptiveRuleProposals(records, modelConfig, evaluatedAt, auditConfig);
    const predictionConfigHashValue = predictionConfigHash(modelConfig);
    const evaluationInputHash = adaptiveRuleEvaluationInputHash(records, modelConfig, auditConfig);
    const runInsert = await this.pool.query<{ id: string }>(`INSERT INTO prediction_adaptive_rule_runs(
      audit_version,model_version,prediction_config_hash,config_hash,input_hash,evaluated_at,proposal_count)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(audit_version,model_version,prediction_config_hash,config_hash,input_hash) DO NOTHING RETURNING id`,
    [auditConfig.version,modelConfig.modelVersion,predictionConfigHashValue,
      adaptiveRuleConfigHash(auditConfig),evaluationInputHash,evaluatedAt,proposals.length]);
    const runId = runInsert.rows[0]?.id ?? (await this.pool.query<{ id: string }>(`SELECT id FROM prediction_adaptive_rule_runs
      WHERE audit_version=$1 AND model_version=$2 AND prediction_config_hash=$3 AND config_hash=$4 AND input_hash=$5`,
    [auditConfig.version,modelConfig.modelVersion,predictionConfigHashValue,
      adaptiveRuleConfigHash(auditConfig),evaluationInputHash])).rows[0]!.id;

    for (const proposal of proposals) {
      await this.pool.query(`INSERT INTO prediction_adaptive_rule_proposals(
        run_id,audit_version,model_version,prediction_config_hash,config_hash,input_hash,proposal_key,proposal_type,severity,
        title,conditions,suggested_change,evaluated_at,binary_sample_size,positive_rate,reference_paper_roi,
        baseline_binary_sample_size,baseline_positive_rate,baseline_reference_paper_roi,positive_rate_gap,
        reference_paper_roi_gap,interaction_positive_rate_gap,interaction_reference_paper_roi_gap,evidence_strength,
        proposal_score,reasons)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb)
        ON CONFLICT(run_id,proposal_key) DO NOTHING`,
      [runId,proposal.version,modelConfig.modelVersion,predictionConfigHashValue,proposal.configHash,proposal.inputHash,
        proposal.proposalKey,proposal.proposalType,proposal.severity,proposal.title,JSON.stringify(proposal.conditions),
        JSON.stringify(proposal.suggestedChange),proposal.evaluatedAt,proposal.binarySampleSize,proposal.positiveRate,
        proposal.referencePaperRoi,proposal.baselineBinarySampleSize,proposal.baselinePositiveRate,
        proposal.baselineReferencePaperRoi,proposal.positiveRateGap,proposal.referencePaperRoiGap,
        proposal.interactionPositiveRateGap,proposal.interactionReferencePaperRoiGap,proposal.evidenceStrength,
        proposal.proposalScore,JSON.stringify(proposal.reasons)]);
    }
    return this.latestAdaptiveRuleProposals(modelConfig);
  }

  async latestAdaptiveRuleProposals(modelConfig: PredictionConfig = predictionConfig) {
    const run = await this.pool.query<{ id: string; evaluated_at: string; proposal_count: number }>(`SELECT id,evaluated_at,proposal_count
      FROM prediction_adaptive_rule_runs WHERE model_version=$1 AND prediction_config_hash=$2
      ORDER BY evaluated_at DESC,created_at DESC,id DESC LIMIT 1`,
    [modelConfig.modelVersion,predictionConfigHash(modelConfig)]);
    if (!run.rows[0] || Number(run.rows[0].proposal_count) === 0) return [];
    const result = await this.pool.query(`SELECT p.*,d.decision,d.note,d.decided_at
      FROM prediction_adaptive_rule_proposals p
      LEFT JOIN prediction_adaptive_rule_decisions d ON d.proposal_id=p.id
      WHERE p.run_id=$1
      ORDER BY CASE p.severity WHEN 'HIGH_RISK' THEN 0 ELSE 1 END,p.proposal_score DESC,p.binary_sample_size DESC,p.proposal_key`,
    [run.rows[0].id]);
    return result.rows.map((row) => ({
      id: String(row.id), version: String(row.audit_version), modelVersion: String(row.model_version),
      predictionConfigHash: String(row.prediction_config_hash), configHash: String(row.config_hash),
      inputHash: String(row.input_hash), proposalKey: String(row.proposal_key),
      proposalType: String(row.proposal_type), severity: String(row.severity), title: String(row.title),
      conditions: Array.isArray(row.conditions) ? row.conditions : [],
      suggestedChange: row.suggested_change as Record<string, unknown>,
      evaluatedAt: new Date(String(row.evaluated_at)), binarySampleSize: Number(row.binary_sample_size),
      positiveRate: Number(row.positive_rate), referencePaperRoi: Number(row.reference_paper_roi),
      baselineBinarySampleSize: Number(row.baseline_binary_sample_size),
      baselinePositiveRate: Number(row.baseline_positive_rate),
      baselineReferencePaperRoi: Number(row.baseline_reference_paper_roi),
      positiveRateGap: Number(row.positive_rate_gap), referencePaperRoiGap: Number(row.reference_paper_roi_gap),
      interactionPositiveRateGap: row.interaction_positive_rate_gap == null ? null : Number(row.interaction_positive_rate_gap),
      interactionReferencePaperRoiGap: row.interaction_reference_paper_roi_gap == null ? null : Number(row.interaction_reference_paper_roi_gap),
      evidenceStrength: Number(row.evidence_strength), proposalScore: Number(row.proposal_score),
      reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
      decision: row.decision == null ? 'PROPOSED' : String(row.decision),
      decisionNote: row.note == null ? null : String(row.note),
      decidedAt: row.decided_at == null ? null : new Date(String(row.decided_at)),
      autoApply: false,
      executionAuthority: false,
    }));
  }

  async decideAdaptiveRuleProposal(proposalId: string, decision: 'APPROVED' | 'REJECTED', note: string | null = null) {
    if (!/^[0-9a-f-]{36}$/i.test(proposalId)) throw new Error('Invalid proposal id');
    const exists = await this.pool.query<{ id: string }>(
      'SELECT id FROM prediction_adaptive_rule_proposals WHERE id=$1', [proposalId]);
    if (!exists.rows[0]) throw new Error('Adaptive rule proposal not found');
    const inserted = await this.pool.query<{ id: string }>(`INSERT INTO prediction_adaptive_rule_decisions(proposal_id,decision,note)
      VALUES($1,$2,$3) ON CONFLICT(proposal_id) DO NOTHING RETURNING id`, [proposalId,decision,note]);
    if (!inserted.rows[0]) throw new Error('Adaptive rule proposal already decided');
    return { proposalId, decision, note, autoApply: false, executionAuthority: false };
  }

  async previews() {
    return (await this.pool.query(`SELECT DISTINCT ON(r.match_id) r.*,m.kickoff_at,l.name league,ht.name home_team,at.name away_team,
      CASE WHEN j.id IS NULL THEN 'PREVIEW' ELSE CASE WHEN j.decision='PREDICT' THEN 'LOCKED_PREDICTION' ELSE 'LOCKED_SKIP' END END state
      FROM prediction_runs r JOIN matches m ON m.id=r.match_id JOIN leagues l ON l.id=m.league_id
      JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      LEFT JOIN prediction_journal j ON j.match_id=r.match_id AND j.model_version=r.model_version
      WHERE m.kickoff_at>now() AND j.id IS NULL ORDER BY r.match_id,r.created_at DESC,r.id DESC`)).rows;
  }

  async oddsSimilarityShowcase(matchLimit = 4, exampleLimit = 5) {
    const safeMatchLimit = Math.max(1, Math.min(8, Math.trunc(matchLimit)));
    const safeExampleLimit = Math.max(1, Math.min(8, Math.trunc(exampleLimit)));
    const result = await this.pool.query(`SELECT DISTINCT ON(r.match_id)
      r.match_id,r.generated_at,r.decision,r.selected_candidate,m.kickoff_at,l.name league,
      ht.name home_team,at.name away_team,
      CASE WHEN j.id IS NULL THEN 'PREVIEW' ELSE
        CASE WHEN j.decision='PREDICT' THEN 'LOCKED_PREDICTION' ELSE 'LOCKED_SKIP' END END state
      FROM prediction_runs r
      JOIN matches m ON m.id=r.match_id
      JOIN leagues l ON l.id=m.league_id
      JOIN teams ht ON ht.id=m.home_team_id
      JOIN teams at ON at.id=m.away_team_id
      LEFT JOIN prediction_journal j ON j.prediction_run_id=r.id
      WHERE m.kickoff_at>=now()-interval '3 hours'
        AND m.kickoff_at<now()+interval '48 hours'
        AND r.selected_candidate IS NOT NULL
      ORDER BY r.match_id,
        CASE WHEN j.id IS NULL THEN 1 ELSE 0 END,
        r.created_at DESC,r.id DESC`);

    const parseCandidate = (value: unknown): Record<string, unknown> | null => {
      if (!value) return null;
      if (typeof value === 'string') {
        try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
      }
      return typeof value === 'object' ? value as Record<string, unknown> : null;
    };

    const selected = result.rows.map((row) => {
      const candidate = parseCandidate(row.selected_candidate);
      const historical = candidate?.historical && typeof candidate.historical === 'object'
        ? candidate.historical as Record<string, unknown> : null;
      const ids = Array.isArray(historical?.exampleIds) ? historical!.exampleIds.map(String).slice(0, safeExampleLimit) : [];
      return { row, candidate, historical, ids };
    }).filter((item) => item.candidate && item.ids.length)
      .sort((a, b) => Number(b.candidate!.predictionScore ?? 0) - Number(a.candidate!.predictionScore ?? 0)
        || Number(b.historical?.settledSampleSize ?? 0) - Number(a.historical?.settledSampleSize ?? 0)
        || new Date(String(a.row.kickoff_at)).getTime() - new Date(String(b.row.kickoff_at)).getTime())
      .slice(0, safeMatchLimit);

    const allIds = [...new Set(selected.flatMap((item) => item.ids))];
    if (!allIds.length) return [];

    const examples = await this.pool.query(`SELECT e.id,e.match_id,e.kickoff_at,e.market_type,e.market_name,e.line,e.selection,
      e.opening_odds,e.current_odds,e.probability_delta_pp,e.settlement_result,e.home_score,e.away_score,
      e.home_corners,e.away_corners,l.name league,ht.name home_team,at.name away_team
      FROM prediction_historical_examples e
      JOIN matches m ON m.id=e.match_id
      JOIN leagues l ON l.id=m.league_id
      JOIN teams ht ON ht.id=m.home_team_id
      JOIN teams at ON at.id=m.away_team_id
      WHERE e.id=ANY($1::uuid[])`, [allIds]);
    const byId = new Map(examples.rows.map((row) => [String(row.id), row]));

    return selected.map(({ row, candidate, historical, ids }) => ({
      current: {
        matchId: String(row.match_id), kickoffAt: row.kickoff_at, league: String(row.league),
        homeTeam: String(row.home_team), awayTeam: String(row.away_team), state: String(row.state),
        marketType: String(candidate!.marketType ?? ''), marketName: String(candidate!.marketName ?? ''),
        line: candidate!.line == null ? null : Number(candidate!.line), selection: String(candidate!.selection ?? ''),
        openingOdds: Number(candidate!.openingOdds), currentOdds: Number(candidate!.currentOdds),
        probabilityDeltaPp: Number(candidate!.probabilityDeltaPp), predictionScore: Number(candidate!.predictionScore),
        bookmakerCount: Number(candidate!.bookmakerCount), agreementRatio: Number(candidate!.agreementRatio),
        historicalSampleSize: Number(historical?.sampleSize ?? 0),
        historicalSettledSampleSize: Number(historical?.settledSampleSize ?? 0),
        historicalHitRate: historical?.historicalHitRate == null ? null : Number(historical.historicalHitRate),
        averageSimilarity: Number(historical?.averageSimilarity ?? 0), scope: String(historical?.scope ?? ''),
      },
      matches: ids.map((id, index) => {
        const example = byId.get(id);
        if (!example) return null;
        return {
          rank: index + 1, exampleId: id, matchId: String(example.match_id), kickoffAt: example.kickoff_at,
          league: String(example.league), homeTeam: String(example.home_team), awayTeam: String(example.away_team),
          marketType: String(example.market_type), marketName: String(example.market_name),
          line: example.line == null ? null : Number(example.line), selection: String(example.selection),
          openingOdds: Number(example.opening_odds), currentOdds: Number(example.current_odds),
          probabilityDeltaPp: Number(example.probability_delta_pp), outcome: String(example.settlement_result),
          homeScore: example.home_score == null ? null : Number(example.home_score),
          awayScore: example.away_score == null ? null : Number(example.away_score),
          homeCorners: example.home_corners == null ? null : Number(example.home_corners),
          awayCorners: example.away_corners == null ? null : Number(example.away_corners),
        };
      }).filter((item): item is NonNullable<typeof item> => item != null),
    }));
  }

  async today(timeZone = 'Europe/Istanbul') {
    return (await this.pool.query(`SELECT j.*,m.kickoff_at,l.name league,ht.name home_team,at.name away_team,s.outcome,
      CASE WHEN j.decision='PREDICT' THEN 'LOCKED_PREDICTION' ELSE 'LOCKED_SKIP' END state,
      CASE WHEN s.id IS NULL AND j.decision='PREDICT' THEN 'PENDING' WHEN s.id IS NULL THEN NULL ELSE 'SETTLED' END settlement_state
      FROM prediction_journal j JOIN matches m ON m.id=j.match_id JOIN leagues l ON l.id=m.league_id
      JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      LEFT JOIN prediction_settlements s ON s.prediction_journal_id=j.id
      WHERE (m.kickoff_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date ORDER BY m.kickoff_at`, [timeZone])).rows;
  }

  async history(limit = 50, offset = 0) {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const safeOffset = Math.max(0, Math.trunc(offset));
    return (await this.pool.query(`SELECT j.*,m.kickoff_at,l.name league,ht.name home_team,at.name away_team,s.outcome,
      s.reference_paper_return,CASE WHEN j.decision='PREDICT' THEN 'LOCKED_PREDICTION' ELSE 'LOCKED_SKIP' END state
      FROM prediction_journal j JOIN matches m ON m.id=j.match_id JOIN leagues l ON l.id=m.league_id
      JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      LEFT JOIN prediction_settlements s ON s.prediction_journal_id=j.id ORDER BY j.kickoff_at DESC LIMIT $1 OFFSET $2`,
    [safeLimit,safeOffset])).rows;
  }

  async detail(matchId: string) {
    const [runs, journal] = await Promise.all([
      this.pool.query('SELECT * FROM prediction_runs WHERE match_id=$1 ORDER BY generated_at DESC,id DESC', [matchId]),
      this.pool.query(`SELECT j.*,s.outcome,s.reference_paper_return FROM prediction_journal j
        LEFT JOIN prediction_settlements s ON s.prediction_journal_id=j.id WHERE j.match_id=$1`, [matchId]),
    ]);
    return { matchId, state: journal.rows[0] ? (journal.rows[0].decision === 'PREDICT' ? 'LOCKED_PREDICTION' : 'LOCKED_SKIP')
      : runs.rows.length ? 'PREVIEW' : 'NOT_GENERATED', journal: journal.rows[0] ?? null, runs: runs.rows };
  }

  async performance() {
    const result = await this.pool.query(`SELECT j.decision,s.outcome,j.market_type,l.name league,j.prediction_score,
      j.confidence_score,j.data_quality_grade,j.bookmaker_count,j.historical_sample_size,j.historical_hit_rate,
      j.movement_class,s.reference_paper_return FROM prediction_journal j JOIN matches m ON m.id=j.match_id
      JOIN leagues l ON l.id=m.league_id LEFT JOIN prediction_settlements s ON s.prediction_journal_id=j.id`);
    return buildPerformance(result.rows.map((row): PerformanceRecord => ({ decision: row.decision, outcome: row.outcome,
      marketType: row.market_type, league: row.league, predictionScore: row.prediction_score == null ? null : Number(row.prediction_score),
      confidenceScore: row.confidence_score == null ? null : Number(row.confidence_score), dataQualityGrade: row.data_quality_grade,
      bookmakerCount: row.bookmaker_count == null ? null : Number(row.bookmaker_count),
      historicalSampleSize: Number(row.historical_sample_size), historicalHitRate: row.historical_hit_rate == null ? null : Number(row.historical_hit_rate),
      movementClass: row.movement_class, referencePaperReturn: row.reference_paper_return == null ? null : Number(row.reference_paper_return) })));
  }

  async backtest(config: PredictionConfig = predictionConfig) {
    const [rows, examples] = await Promise.all([
      this.pool.query(`SELECT m.id match_id,m.league_id competition_id,m.kickoff_at,
        COALESCE(jsonb_agg(to_jsonb(os) ORDER BY os.captured_at,os.id) FILTER(WHERE os.id IS NOT NULL),'[]'::jsonb) snapshots
        FROM matches m LEFT JOIN odds_snapshots os ON os.match_id=m.id WHERE m.status IN('finished','cancelled')
        GROUP BY m.id ORDER BY m.kickoff_at`), this.loadHistoricalExamples(undefined, true),
    ]);
    const targets = rows.rows.map((row) => ({ matchId: String(row.match_id), competitionId: String(row.competition_id),
      kickoffAt: new Date(String(row.kickoff_at)), snapshots: (row.snapshots as Array<Record<string, unknown>>).map((item) => ({
        matchId: String(row.match_id), provider: String(item.provider), marketType: String(item.market_type), marketName: String(item.market_name),
        line: item.line == null ? null : Number(item.line), selection: String(item.selection), oddsDecimal: Number(item.odds_decimal),
        capturedAt: new Date(String(item.captured_at)),
      })) }));
    return runPredictionBacktestFromSnapshots(targets, examples, config);
  }
}

export class PredictionService {
  constructor(private readonly repository: PredictionRepository, private readonly config: PredictionConfig = predictionConfig) {}

  private rehashDecision(evaluation: PredictionEvaluation, reason: string): PredictionEvaluation {
    return { ...evaluation,
      inputHash: createHash('sha256').update(`${evaluation.inputHash}|decision-guard:${reason}`).digest('hex') };
  }

  private attachSelfAudit(evaluation: PredictionEvaluation, audit: Awaited<ReturnType<PredictionRepository['latestSelfAudit']>>) {
    if (!audit) return evaluation;
    const warning = audit.status === 'WATCH' ? 'SELF_AUDIT_WATCH'
      : audit.status === 'PAUSED' && audit.guardActive ? 'SELF_AUDIT_PAUSED'
      : audit.status === 'PAUSED' ? 'SELF_AUDIT_RECOVERY' : null;
    const selectedCandidate = evaluation.selectedCandidate && warning
      ? { ...evaluation.selectedCandidate, warnings: [...new Set([...evaluation.selectedCandidate.warnings, warning])] }
      : evaluation.selectedCandidate;
    return {
      ...evaluation,
      inputHash: createHash('sha256').update(`${evaluation.inputHash}|self-audit:${audit.inputHash}:${audit.status}`).digest('hex'),
      selectedCandidate,
      metadata: { ...evaluation.metadata, selfAuditStatus: audit.status, selfAuditId: audit.id },
    };
  }

  private matchingSegmentAudits(
    evaluation: PredictionEvaluation,
    audits: Awaited<ReturnType<PredictionRepository['latestSegmentSelfAudits']>>,
  ) {
    if (!evaluation.selectedCandidate) return [];
    const keys = new Set(segmentKeysFor(evaluation.competitionId, evaluation.selectedCandidate.marketType));
    return audits.filter((audit) => keys.has(audit.segmentKey));
  }

  private attachSegmentSelfAudit(
    evaluation: PredictionEvaluation,
    audits: Awaited<ReturnType<PredictionRepository['latestSegmentSelfAudits']>>,
  ): PredictionEvaluation {
    const relevant = this.matchingSegmentAudits(evaluation, audits);
    if (!relevant.length || !evaluation.selectedCandidate) return evaluation;
    const warnings = relevant.flatMap((audit) => audit.status === 'WATCH'
      ? [`SELF_AUDIT_SEGMENT_WATCH:${audit.segmentKey}`]
      : audit.status === 'PAUSED' && audit.guardActive
        ? [`SELF_AUDIT_SEGMENT_PAUSED:${audit.segmentKey}`]
        : audit.status === 'PAUSED'
          ? [`SELF_AUDIT_SEGMENT_RECOVERY:${audit.segmentKey}`]
          : []);
    const statusMap = Object.fromEntries(relevant.map((audit) => [audit.segmentKey, audit.status]));
    const auditFingerprint = relevant.slice().sort((a, b) => a.segmentKey.localeCompare(b.segmentKey))
      .map((audit) => `${audit.segmentKey}:${audit.inputHash}:${audit.status}:${audit.guardActive}`).join('|');
    return {
      ...evaluation,
      inputHash: createHash('sha256').update(`${evaluation.inputHash}|segment-audit:${auditFingerprint}`).digest('hex'),
      selectedCandidate: { ...evaluation.selectedCandidate,
        warnings: [...new Set([...evaluation.selectedCandidate.warnings, ...warnings])] },
      metadata: { ...evaluation.metadata, selfAuditSegmentKeys: relevant.map((audit) => audit.segmentKey),
        selfAuditSegmentStatuses: statusMap },
    };
  }

  async refreshPreviewsAndLocks(now = new Date()) {
    const [targets, examples, selfAudit, segmentAudits] = await Promise.all([
      this.repository.loadTargets(), this.repository.loadHistoricalExamples(), this.repository.latestSelfAudit(this.config),
      this.repository.latestSegmentSelfAudits(this.config),
    ]);
    let previews = 0; let lockedPredictions = 0; let lockedSkips = 0; let missed = 0;
    let selfAuditBlocked = 0; let selfAuditSegmentBlocked = 0;
    for (const target of targets) {
      let evaluation = this.attachSelfAudit(evaluatePrediction(target, examples, now, this.config), selfAudit);
      evaluation = this.attachSegmentSelfAudit(evaluation, segmentAudits);
      const window = lockWindowState(target.kickoffAt, now, this.config);
      if (window.missed) {
        evaluation = this.rehashDecision({ ...evaluation, decision: 'SKIP', selectedCandidate: null,
          skipReasons: [...new Set([...evaluation.skipReasons, 'LOCK_WINDOW_MISSED' as const])],
        }, 'LOCK_WINDOW_MISSED');
        const runId = await this.repository.saveRun(evaluation, this.config);
        // A missed pre-kickoff window is itself an official, auditable SKIP. The
        // unique journal constraint preserves the first decision if another worker
        // observes the same match concurrently.
        if (target.kickoffAt > now && await this.repository.lock(evaluation, runId, now, window.minutesToKickoff, this.config)) lockedSkips += 1;
        missed += 1;
        continue;
      }
      if (window.eligible && selfAudit?.status === 'PAUSED' && selfAudit.guardActive && evaluation.decision === 'PREDICT') {
        evaluation = this.rehashDecision({
          ...evaluation,
          decision: 'SKIP',
          selectedCandidate: null,
          skipReasons: [...new Set([...evaluation.skipReasons, 'SELF_AUDIT_PAUSED' as const])],
        }, 'SELF_AUDIT_PAUSED');
        selfAuditBlocked += 1;
      } else if (window.eligible && evaluation.decision === 'PREDICT') {
        const pausedSegments = this.matchingSegmentAudits(evaluation, segmentAudits)
          .filter((audit) => audit.status === 'PAUSED' && audit.guardActive).map((audit) => audit.segmentKey).sort();
        if (pausedSegments.length) {
          evaluation = this.rehashDecision({
            ...evaluation,
            decision: 'SKIP',
            selectedCandidate: null,
            skipReasons: [...new Set([...evaluation.skipReasons, 'SELF_AUDIT_SEGMENT_PAUSED' as const])],
          }, `SELF_AUDIT_SEGMENT_PAUSED:${pausedSegments.join(',')}`);
          selfAuditSegmentBlocked += 1;
        }
      }
      const runId = await this.repository.saveRun(evaluation, this.config);
      previews += 1;
      if (window.eligible && await this.repository.lock(evaluation, runId, now, window.minutesToKickoff, this.config)) {
        if (evaluation.decision === 'PREDICT') lockedPredictions += 1; else lockedSkips += 1;
      }
    }
    return { matches: targets.length, previews, lockedPredictions, lockedSkips, missed, selfAuditBlocked, selfAuditSegmentBlocked,
      selfAuditStatus: selfAudit?.status ?? 'NOT_AVAILABLE', selfAuditGuardActive: selfAudit?.guardActive ?? false,
      activePausedSegments: segmentAudits.filter((audit) => audit.status === 'PAUSED' && audit.guardActive).length };
  }
}
