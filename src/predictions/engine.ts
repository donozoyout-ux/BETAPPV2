import { createHash } from 'node:crypto';
import type { AnalysisItem } from '../odds-analysis/types.js';
import { predictionConfig, predictionConfigHash, type PredictionConfig } from './config.js';
import { scorePrediction } from './scoring.js';
import { findHistoricalEvidence } from './similarity.js';
import type { HistoricalExample, PredictionCandidate, PredictionEvaluation, PredictionTarget, SkipReason } from './types.js';

const supported = new Set(['MATCH_RESULT', '1X2', 'TOTAL_GOALS', 'TOTAL_CORNERS', 'ASIAN_HANDICAP']);
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, stable(item)])) : value;

function reasons(item: AnalysisItem, candidate: PredictionCandidate, config: PredictionConfig): SkipReason[] {
  const result: SkipReason[] = [];
  if (![...supported].some((name) => item.marketType.toUpperCase().includes(name))) result.push('UNSUPPORTED_MARKET');
  if (!item.analysisEligible) result.push('ODDS_NOT_ELIGIBLE');
  if (item.dataQuality.score < config.minimumDataQualityScore) result.push('LOW_DATA_QUALITY');
  if (item.modelConfidence.score < config.minimumConfidenceScore) result.push('LOW_MODEL_CONFIDENCE');
  if (item.bookmakerCount < config.minimumBookmakerCount) result.push('INSUFFICIENT_BOOKMAKERS');
  // Both values below are observations from the current ODDS analysis item, never copied thresholds.
  if (item.completeStateBookmakerCount < config.minimumBookmakerCount
    || item.minimumCompleteStateCount < config.minimumCompleteStateCount) result.push('INSUFFICIENT_COMPLETE_STATES');
  if (!['SUPPORT', 'STRONG_SUPPORT'].includes(item.movementClass)) result.push('MOVEMENT_NOT_SUPPORTED');
  if (candidate.historical.status === 'INSUFFICIENT_SAMPLE') result.push('INSUFFICIENT_HISTORICAL_SAMPLE');
  if (candidate.cornerConfirmation === 'CONFLICT') result.push('CONFLICTING_CORNER_MODEL');
  if (candidate.predictionScore < config.minimumPredictionScore) result.push('LOW_PREDICTION_SCORE');
  return result;
}

function candidate(item: AnalysisItem, competitionId: string, kickoffAt: Date, examples: HistoricalExample[], config: PredictionConfig) {
  const historical = findHistoricalEvidence(item, competitionId, kickoffAt, examples, config);
  const scored = scorePrediction(item, historical, config);
  const corner = item.marketType.toUpperCase().includes('TOTAL_CORNERS');
  const gap = item.modelMarketGapPp;
  const conflict = corner && gap != null && (item.selection === 'OVER' ? gap <= -config.cornerConflictGapPp : gap >= config.cornerConflictGapPp);
  const confirmation = !corner || gap == null ? 'UNAVAILABLE' : conflict ? 'CONFLICT' : 'CONFIRM';
  return {
    marketType: item.marketType, marketName: item.marketName, line: item.line, selection: item.selection,
    referenceOdds: item.currentOdds, openingOdds: item.openingOdds, currentOdds: item.currentOdds,
    currentFairProbability: item.currentFairProbability, probabilityDeltaPp: item.probabilityDeltaPp,
    predictionScore: scored.score, scoreComponents: scored.components, bookmakerCount: item.bookmakerCount,
    agreementRatio: item.movementAgreementRatio, dataQualityScore: item.dataQuality.score,
    dataQualityGrade: item.dataQuality.grade, confidenceScore: item.modelConfidence.score,
    confidenceGrade: item.modelConfidence.grade, movementClass: item.movementClass, analysisEligible: item.analysisEligible,
    snapshotCount: item.snapshotCount, completeStateBookmakerCount: item.completeStateBookmakerCount,
    minimumCompleteStateCount: item.minimumCompleteStateCount, historical,
    cornerModelProbability: gap == null ? null : item.currentFairProbability + gap / 100,
    marketFairProbability: item.currentFairProbability, modelMarketGapPp: gap,
    // ODDS data quality is not Corner Engine quality. The latter is unavailable
    // here unless an actual corner-analysis row is explicitly loaded.
    cornerQuality: null, cornerConfirmation: confirmation,
    reasons: ['ODDS_STRONG_SUPPORT', 'BOOKMAKER_AGREEMENT', ...(historical.status === 'SUFFICIENT'
      ? ['HISTORICAL_SAMPLE_OK', 'HISTORICAL_RATE_SUPPORT'] : [])],
    warnings: [...item.warnings, ...(historical.status === 'INSUFFICIENT_SAMPLE' ? ['HISTORICAL_SAMPLE_SMALL'] : []),
      ...(conflict ? ['CORNER_MODEL_CONFLICT'] : [])],
  } satisfies PredictionCandidate;
}

export function evaluatePrediction(target: PredictionTarget, examples: HistoricalExample[], generatedAt = new Date(),
  config: PredictionConfig = predictionConfig): PredictionEvaluation {
  const candidates = target.oddsItems.map((item) => candidate(item, target.competitionId, target.kickoffAt, examples, config));
  const reasonPairs = target.oddsItems.map((item, index) => reasons(item, candidates[index]!, config));
  const qualifying = candidates.filter((_item, index) => reasonPairs[index]!.length === 0)
    .sort((a, b) => b.predictionScore - a.predictionScore || b.historical.settledSampleSize - a.historical.settledSampleSize
      || `${a.marketType}:${a.marketName}:${a.line}:${a.selection}`.localeCompare(`${b.marketType}:${b.marketName}:${b.line}:${b.selection}`));
  const selectedCandidate = qualifying[0] ?? null;
  const skipReasons = [...new Set(reasonPairs.flat())];
  if (!target.oddsItems.length) skipReasons.push('NO_ODDS_ANALYSIS');
  const hashPayload = { matchId: target.matchId, kickoffAt: target.kickoffAt.toISOString(), oddsInputHash: target.oddsInputHash,
    historical: candidates.map((item) => item.historical.exampleIds), configHash: predictionConfigHash(config) };
  return {
    matchId: target.matchId, competitionId: target.competitionId, kickoffAt: target.kickoffAt,
    modelVersion: config.modelVersion, configHash: predictionConfigHash(config),
    inputHash: createHash('sha256').update(JSON.stringify(stable(hashPayload))).digest('hex'),
    oddsAnalysisInputHash: target.oddsInputHash, generatedAt, decision: selectedCandidate ? 'PREDICT' : 'SKIP',
    selectedCandidate, candidates, skipReasons: selectedCandidate ? [] : skipReasons,
    metadata: { executionAuthority: false, aiPredictionAuthority: false, historicalExamplesConsidered: examples.length },
  };
}

export function lockWindowState(kickoffAt: Date, now: Date, config: PredictionConfig = predictionConfig) {
  const minutes = (kickoffAt.getTime() - now.getTime()) / 60_000;
  if (minutes < config.minimumLockLeadMinutes) return { eligible: false, missed: true, minutesToKickoff: minutes };
  return { eligible: minutes <= config.officialWindowStartMinutes, missed: false, minutesToKickoff: minutes };
}
