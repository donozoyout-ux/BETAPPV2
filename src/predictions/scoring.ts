import type { AnalysisItem } from '../odds-analysis/types.js';
import type { PredictionConfig } from './config.js';
import type { HistoricalEvidence, PredictionScoreComponents } from './types.js';

const round = (value: number) => Number(value.toFixed(2));

export function scorePrediction(item: AnalysisItem, historical: HistoricalEvidence,
  config: PredictionConfig): { score: number; components: PredictionScoreComponents } {
  const weight = config.scoreWeights;
  const components: PredictionScoreComponents = {
    marketProbability: round(item.currentFairProbability * weight.marketProbability),
    oddsSignal: round(Math.min(1, Math.max(0, item.probabilityDeltaPp) / 5) * weight.oddsSignal),
    historicalEvidence: round((historical.historicalHitRate ?? 0) * weight.historicalEvidence),
    historicalSampleReliability: round(Math.min(1, historical.settledSampleSize / config.targetHistoricalSample)
      * weight.historicalSampleReliability),
    bookmakerAgreement: round(item.movementAgreementRatio * weight.bookmakerAgreement),
    dataQuality: round(item.dataQuality.score / 100 * weight.dataQuality),
    modelConfidence: round(item.modelConfidence.score / 100 * weight.modelConfidence),
  };
  return { score: round(Object.values(components).reduce((sum, value) => sum + value, 0)), components };
}
