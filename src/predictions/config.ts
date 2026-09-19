import { createHash } from 'node:crypto';

export type PredictionConfig = {
  modelVersion: 'PREDICTION_V1'; openingProbabilityTolerancePp: number; currentProbabilityTolerancePp: number;
  movementTolerancePp: number; openingOddsTolerancePercent: number; currentOddsTolerancePercent: number;
  agreementTolerance: number; minimumHistoricalSample: number; targetHistoricalSample: number;
  maximumHistoricalExamples: number; minimumPredictionScore: number; minimumDataQualityScore: number;
  minimumConfidenceScore: number; minimumBookmakerCount: number; minimumCompleteStateCount: number;
  officialWindowStartMinutes: number; minimumLockLeadMinutes: number; cornerConflictGapPp: number;
  maximumOfficialPredictionsPerMatch: 1;
  scoreWeights: { marketProbability: number; oddsSignal: number; historicalEvidence: number;
    historicalSampleReliability: number; bookmakerAgreement: number; dataQuality: number; modelConfidence: number };
};

// Engineering defaults only. These thresholds have not been scientifically optimized or calibrated.
export const predictionConfig: PredictionConfig = {
  modelVersion: 'PREDICTION_V1', openingProbabilityTolerancePp: 8, currentProbabilityTolerancePp: 8,
  movementTolerancePp: 4, openingOddsTolerancePercent: 20, currentOddsTolerancePercent: 20,
  agreementTolerance: 0.3, minimumHistoricalSample: 30, targetHistoricalSample: 100,
  maximumHistoricalExamples: 250, minimumPredictionScore: 70, minimumDataQualityScore: 50,
  minimumConfidenceScore: 45, minimumBookmakerCount: 3, minimumCompleteStateCount: 2,
  officialWindowStartMinutes: 90, minimumLockLeadMinutes: 10, cornerConflictGapPp: 8,
  maximumOfficialPredictionsPerMatch: 1,
  scoreWeights: { marketProbability: 20, oddsSignal: 20, historicalEvidence: 25,
    historicalSampleReliability: 15, bookmakerAgreement: 10, dataQuality: 5, modelConfidence: 5 },
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function validatePredictionConfig(config: PredictionConfig = predictionConfig): PredictionConfig {
  if (Object.values(config.scoreWeights).reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error('PREDICTION_V1 score weights must sum to 100');
  }
  if (config.minimumLockLeadMinutes >= config.officialWindowStartMinutes) throw new Error('Invalid official lock window');
  if (Object.values(config).some((value) => typeof value === 'number' && (!Number.isFinite(value) || value < 0))) {
    throw new Error('PREDICTION_V1 config values must be finite and non-negative');
  }
  return config;
}

export function predictionConfigHash(config: PredictionConfig = predictionConfig): string {
  return createHash('sha256').update(JSON.stringify(stable(validatePredictionConfig(config)))).digest('hex');
}
