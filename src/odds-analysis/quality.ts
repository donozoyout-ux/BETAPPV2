import type { AnalysisConfig, ConsensusResult, DataQuality, ModelConfidence, QualityGrade } from './types.js';

function grade(score: number, good: number, limited: number): QualityGrade {
  return score >= good ? 'GOOD' : score >= limited ? 'LIMITED' : 'POOR';
}

export function freshnessMinutes(latest: Date, cutoff: Date): number {
  return Math.max(0, (cutoff.getTime() - latest.getTime()) / 60_000);
}

export function calculateDataQuality(consensus: ConsensusResult, cutoff: Date, config: AnalysisConfig): DataQuality {
  const warnings: string[] = [];
  const coverageRatio = Math.min(1, consensus.bookmakerCount / config.targetBookmakerCount);
  const snapshotRatio = Math.min(1, consensus.snapshotCount / (consensus.bookmakerCount * config.minimumSnapshotCount));
  const ageMinutes = freshnessMinutes(consensus.latestCapturedAt, cutoff);
  const freshnessRatio = Math.max(0, 1 - ageMinutes / config.staleSnapshotMinutes);
  if (consensus.bookmakerCount < config.minimumBookmakerCount) warnings.push(`only ${consensus.bookmakerCount} bookmakers available`);
  const hasOpeningAndCurrent = consensus.minimumSelectionSnapshotCount >= config.minimumSnapshotCount;
  if (!hasOpeningAndCurrent) warnings.push('opening/current snapshot coverage limited');
  if (ageMinutes > config.staleSnapshotMinutes) warnings.push(`latest snapshot is stale (${Math.round(ageMinutes)} minutes old)`);
  const score = Math.round(coverageRatio * 40 + snapshotRatio * 30 + freshnessRatio * 20 + 10);
  const qualityGrade = grade(score, config.qualityGoodThreshold, config.qualityLimitedThreshold);
  return { score, grade: qualityGrade,
    analysisEligible: qualityGrade !== 'POOR' && consensus.bookmakerCount >= config.minimumBookmakerCount
      && hasOpeningAndCurrent, warnings };
}

export function calculateModelConfidence(consensus: ConsensusResult, config: AnalysisConfig): ModelConfidence {
  const movement = Math.min(1, Math.abs(consensus.medianProbabilityDeltaPp) / config.strongProbabilityChangePp);
  const agreement = consensus.movementAgreementRatio;
  const coverage = Math.min(1, consensus.bookmakerCount / config.targetBookmakerCount);
  const stability = Math.max(0, 1 - consensus.probabilityDispersion / config.maximumDispersionPp);
  const score = Math.round((movement * 0.35 + agreement * 0.3 + coverage * 0.2 + stability * 0.15) * 100);
  return { score, grade: grade(score, config.confidenceGoodThreshold, config.confidenceLimitedThreshold) };
}
