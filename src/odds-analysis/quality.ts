import type { AnalysisConfig, ConsensusResult, DataQuality, ModelConfidence, QualityGrade } from './types.js';

function grade(score: number, good: number, limited: number): QualityGrade {
  return score >= good ? 'GOOD' : score >= limited ? 'LIMITED' : 'POOR';
}

export function freshnessMinutes(latest: Date, cutoff: Date): number {
  return Math.max(0, (cutoff.getTime() - latest.getTime()) / 60_000);
}

export function calculateDataQuality(consensus: ConsensusResult, cutoff: Date, config: AnalysisConfig): DataQuality {
  const warnings: string[] = [];
  const coverageRatio = Math.min(1, consensus.completeStateBookmakerCount / config.targetBookmakerCount);
  const completeStateCoverage = consensus.bookmakerCount === 0 ? 0
    : consensus.completeStateBookmakerCount / consensus.bookmakerCount;
  const ageMinutes = freshnessMinutes(consensus.latestCapturedAt, cutoff);
  const freshnessRatio = Math.max(0, 1 - ageMinutes / config.staleSnapshotMinutes);
  if (consensus.bookmakerCount < config.minimumBookmakerCount) warnings.push(`only ${consensus.bookmakerCount} bookmakers available`);
  const hasOpeningAndCurrent = consensus.completeStateBookmakerCount >= config.minimumBookmakerCount
    && consensus.minimumCompleteStateCount >= 2;
  if (!hasOpeningAndCurrent) {
    warnings.push(consensus.minimumCompleteStateCount <= 1
      ? 'FIRST_COMPLETE_ODDS_MEASUREMENT'
      : 'INSUFFICIENT_COMPLETE_ODDS_STATES');
  }
  if (ageMinutes > config.staleSnapshotMinutes) warnings.push(`latest snapshot is stale (${Math.round(ageMinutes)} minutes old)`);
  const marketCompleteness = consensus.bookmakerCount > 0 ? 1 : 0;
  const validOpening = consensus.minimumCompleteStateCount >= 1 ? 1 : 0;
  const validCurrent = consensus.minimumCompleteStateCount >= 1 ? 1 : 0;
  let score = Math.round(coverageRatio * 30 + completeStateCoverage * 25 + freshnessRatio * 20
    + marketCompleteness * 15 + validOpening * 5 + validCurrent * 5);
  if (consensus.bookmakerCount < config.minimumBookmakerCount && ageMinutes > config.staleSnapshotMinutes) {
    score = Math.min(score, config.qualityLimitedThreshold - 1);
  }
  const qualityGrade = grade(score, config.qualityGoodThreshold, config.qualityLimitedThreshold);
  return { score, grade: qualityGrade,
    analysisEligible: qualityGrade !== 'POOR' && consensus.bookmakerCount >= config.minimumBookmakerCount
      && hasOpeningAndCurrent, warnings };
}

export function calculateModelConfidence(consensus: ConsensusResult, config: AnalysisConfig): ModelConfidence {
  const movement = Math.min(1, Math.abs(consensus.medianProbabilityDeltaPp) / config.strongProbabilityChangePp);
  const agreement = consensus.movementAgreementRatio;
  const coverage = Math.min(1, consensus.completeStateBookmakerCount / config.targetBookmakerCount);
  const stability = Math.max(0, 1 - consensus.probabilityDispersion / config.maximumDispersionPp);
  const score = Math.round((movement * 0.35 + agreement * 0.3 + coverage * 0.2 + stability * 0.15) * 100);
  return { score, grade: grade(score, config.confidenceGoodThreshold, config.confidenceLimitedThreshold) };
}
