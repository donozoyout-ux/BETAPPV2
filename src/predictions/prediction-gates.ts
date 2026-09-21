import { predictionConfig, type PredictionConfig } from './config.js';
import type { PredictionCandidate, SkipReason } from './types.js';

const supportedMarkets = ['MATCH_RESULT', '1X2', 'TOTAL_GOALS', 'TOTAL_CORNERS', 'ASIAN_HANDICAP'] as const;

export function isSupportedPredictionMarket(marketType: string): boolean {
  const normalized = marketType.toUpperCase();
  return supportedMarkets.some((name) => normalized.includes(name));
}

/** Shared completeness policy for official qualification and its presentation. */
export function hasRequiredCompleteStates(candidate: PredictionCandidate,
  config: PredictionConfig = predictionConfig): boolean {
  return Number.isFinite(candidate.completeStateBookmakerCount)
    && candidate.completeStateBookmakerCount >= config.minimumBookmakerCount
    && Number.isFinite(candidate.minimumCompleteStateCount)
    && candidate.minimumCompleteStateCount >= config.minimumCompleteStateCount;
}

/** The official engine and the inspector share this exact ordered gate policy. */
export function officialCandidateBlockers(candidate: PredictionCandidate,
  config: PredictionConfig = predictionConfig): SkipReason[] {
  const blockers: SkipReason[] = [];
  if (!isSupportedPredictionMarket(candidate.marketType)) blockers.push('UNSUPPORTED_MARKET');
  if (!candidate.analysisEligible) blockers.push('ODDS_NOT_ELIGIBLE');
  if (candidate.dataQualityScore < config.minimumDataQualityScore) blockers.push('LOW_DATA_QUALITY');
  if (candidate.confidenceScore < config.minimumConfidenceScore) blockers.push('LOW_MODEL_CONFIDENCE');
  if (candidate.bookmakerCount < config.minimumBookmakerCount) blockers.push('INSUFFICIENT_BOOKMAKERS');
  if (!hasRequiredCompleteStates(candidate, config)) blockers.push('INSUFFICIENT_COMPLETE_STATES');
  if (!['SUPPORT', 'STRONG_SUPPORT'].includes(candidate.movementClass)) blockers.push('MOVEMENT_NOT_SUPPORTED');
  if (candidate.historical.settledSampleSize < config.minimumHistoricalSample) blockers.push('INSUFFICIENT_HISTORICAL_SAMPLE');
  if (candidate.cornerConfirmation === 'CONFLICT') blockers.push('CONFLICTING_CORNER_MODEL');
  if (candidate.predictionScore < config.minimumPredictionScore) blockers.push('LOW_PREDICTION_SCORE');
  return blockers;
}

export function predictionWindowState(kickoffAt: Date, now: Date,
  config: PredictionConfig = predictionConfig) {
  const minutesToKickoff = (kickoffAt.getTime() - now.getTime()) / 60_000;
  if (minutesToKickoff < config.minimumLockLeadMinutes) {
    return { eligible: false, missed: true, waiting: false, minutesToKickoff };
  }
  const eligible = minutesToKickoff <= config.officialWindowStartMinutes;
  return { eligible, missed: false, waiting: !eligible, minutesToKickoff };
}
