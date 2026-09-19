import type { AnalysisItem } from '../odds-analysis/types.js';
import type { PredictionConfig } from './config.js';
import type { HistoricalEvidence, HistoricalExample, SettlementOutcome } from './types.js';

export function sameMarketIdentity(item: Pick<AnalysisItem, 'marketType' | 'marketName' | 'line' | 'selection'>,
  example: Pick<HistoricalExample, 'marketType' | 'marketName' | 'line' | 'selection'>): boolean {
  if (item.marketType !== example.marketType || item.marketName !== example.marketName || item.selection !== example.selection) return false;
  return item.line === example.line;
}

export function wilsonInterval(positive: number, sample: number): [number | null, number | null] {
  if (sample <= 0) return [null, null];
  const z = 1.959963984540054;
  const p = positive / sample;
  const denominator = 1 + z ** 2 / sample;
  const center = (p + z ** 2 / (2 * sample)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * sample)) / sample) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function distance(item: AnalysisItem, example: HistoricalExample, config: PredictionConfig): number | null {
  const dimensions: Array<[number, number]> = [
    [Math.abs(item.openingFairProbability - example.openingFairProbability) * 100, config.openingProbabilityTolerancePp],
    [Math.abs(item.currentFairProbability - example.currentFairProbability) * 100, config.currentProbabilityTolerancePp],
    [Math.abs(item.probabilityDeltaPp - example.probabilityDeltaPp), config.movementTolerancePp],
    [Math.abs(item.openingOdds - example.openingOdds) / item.openingOdds * 100, config.openingOddsTolerancePercent],
    [Math.abs(item.currentOdds - example.currentOdds) / item.currentOdds * 100, config.currentOddsTolerancePercent],
    [Math.abs(item.movementAgreementRatio - example.movementAgreementRatio), config.agreementTolerance],
  ];
  if (dimensions.some(([value, tolerance]) => tolerance === 0 ? value !== 0 : value > tolerance)) return null;
  return dimensions.reduce((sum, [value, tolerance]) => sum + (tolerance ? value / tolerance : 0), 0) / dimensions.length;
}

function positive(outcome: SettlementOutcome): boolean { return outcome === 'WIN' || outcome === 'HALF_WIN'; }
function binary(outcome: SettlementOutcome): boolean { return !['PUSH', 'VOID'].includes(outcome); }

export function findHistoricalEvidence(item: AnalysisItem, competitionId: string, kickoffAt: Date,
  examples: HistoricalExample[], config: PredictionConfig): HistoricalEvidence {
  const matches = examples.filter((example) => example.kickoffAt < kickoffAt && sameMarketIdentity(item, example))
    .map((example) => ({ example, distance: distance(item, example, config) }))
    .filter((entry): entry is { example: HistoricalExample; distance: number } => entry.distance != null)
    .sort((a, b) => a.distance - b.distance || a.example.kickoffAt.getTime() - b.example.kickoffAt.getTime());
  const local = matches.filter((entry) => entry.example.competitionId === competitionId);
  const useLocal = local.filter((entry) => binary(entry.example.settlementResult)).length >= config.minimumHistoricalSample;
  const selected = (useLocal ? local : matches).slice(0, config.maximumHistoricalExamples);
  const outcomes = selected.map((entry) => entry.example.settlementResult);
  const settled = outcomes.filter(binary);
  const wins = outcomes.filter((outcome) => outcome === 'WIN').length;
  const losses = outcomes.filter((outcome) => outcome === 'LOSS').length;
  const pushes = outcomes.filter((outcome) => outcome === 'PUSH').length;
  const halfWins = outcomes.filter((outcome) => outcome === 'HALF_WIN').length;
  const halfLosses = outcomes.filter((outcome) => outcome === 'HALF_LOSS').length;
  const positives = settled.filter(positive).length;
  const rate = settled.length ? positives / settled.length : null;
  const [lower, upper] = wilsonInterval(positives, settled.length);
  return {
    exampleIds: selected.map((entry) => entry.example.id), sampleSize: selected.length, settledSampleSize: settled.length,
    wins, losses, pushes, halfWins, halfLosses, historicalHitRate: rate, wilsonLower95: lower, wilsonUpper95: upper,
    averageSimilarity: selected.length ? 1 - selected.reduce((sum, entry) => sum + entry.distance, 0) / selected.length : 0,
    scope: useLocal ? 'SAME_COMPETITION' : 'GLOBAL_SUPPORTED_COMPETITIONS',
    historicalFrequencyGapPp: rate == null ? null : (rate - item.currentFairProbability) * 100,
    status: settled.length >= config.minimumHistoricalSample ? 'SUFFICIENT' : 'INSUFFICIENT_SAMPLE',
  };
}
