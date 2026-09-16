import type { CornerModelConfig } from './config.js';
import { analyzeCorners } from './engine.js';
import { buildLeagueBaseline } from './profiles.js';
import type { DataQualityStatus, HistoricalCornerMatch } from './types.js';

const lines = [7.5, 8.5, 9.5, 10.5, 11.5, 12.5] as const;
const calibrationBuckets = [
  { name: '50-55', min: 0.50, max: 0.55 }, { name: '55-60', min: 0.55, max: 0.60 },
  { name: '60-65', min: 0.60, max: 0.65 }, { name: '65-70', min: 0.65, max: 0.70 },
  { name: '70-75', min: 0.70, max: 0.75 }, { name: '75-80', min: 0.75, max: 0.80 },
  { name: '80-85', min: 0.80, max: 0.85 }, { name: '85+', min: 0.85, max: 1.000001 },
] as const;
const confidenceBuckets = [
  { name: '0-39', min: 0, max: 40 }, { name: '40-49', min: 40, max: 50 }, { name: '50-59', min: 50, max: 60 },
  { name: '60-69', min: 60, max: 70 }, { name: '70-79', min: 70, max: 80 }, { name: '80-89', min: 80, max: 90 },
  { name: '90+', min: 90, max: 101 },
] as const;

type Prediction = {
  match: HistoricalCornerMatch; expected: number; actual: number; probabilities: Record<string, number>;
  confidence: number; quality: DataQualityStatus; missingDataRate: number; homeSample: number; awaySample: number;
  distribution: string;
};

const epsilon = 1e-12;
const safeProbability = (value: number) => Math.min(1 - epsilon, Math.max(epsilon, value));

function predictionBrier(item: Prediction) {
  return lines.reduce((sum, line) => sum + (item.probabilities[String(line)]! - (item.actual > line ? 1 : 0)) ** 2, 0) / lines.length;
}

function performance(items: Prediction[]) {
  if (!items.length) return { sample: 0, mae: 0, brier: 0, calibrationError: 0 };
  const binary = items.flatMap((item) => lines.map((line) => ({ probability: item.probabilities[String(line)]!, hit: item.actual > line ? 1 : 0 })));
  const predicted = binary.reduce((sum, item) => sum + item.probability, 0) / binary.length;
  const actual = binary.reduce((sum, item) => sum + item.hit, 0) / binary.length;
  return { sample: items.length, mae: items.reduce((sum, item) => sum + Math.abs(item.expected - item.actual), 0) / items.length,
    brier: items.reduce((sum, item) => sum + predictionBrier(item), 0) / items.length, calibrationError: actual - predicted };
}

export function runBacktest(matches: HistoricalCornerMatch[], config: CornerModelConfig) {
  const sorted = [...matches].sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
  const predictions: Prediction[] = [];
  let skippedMissingCorners = 0;
  let skippedInsufficientHistory = 0;
  let chronologicalViolations = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const match = sorted[index]!;
    if (match.homeCorners == null || match.awayCorners == null) { skippedMissingCorners += 1; continue; }
    const prior = sorted.slice(0, index).filter((item) => item.kickoffAt < match.kickoffAt);
    if (prior.some((item) => item.kickoffAt >= match.kickoffAt)) chronologicalViolations += 1;
    const baseline = buildLeagueBaseline(prior, match.competitionId, match.season, match.kickoffAt);
    if (baseline.sampleSize < config.minimumDistributionSample) { skippedInsufficientHistory += 1; continue; }
    const analysis = analyzeCorners({ match, history: prior, baseline }, config);
    if (analysis.sample.home < 1 || analysis.sample.away < 1) { skippedInsufficientHistory += 1; continue; }
    const supportingFields = [[match.homeXg,match.awayXg],[match.homeShots,match.awayShots],
      [match.homeShotsOnTarget,match.awayShotsOnTarget],[match.homePossession,match.awayPossession],
      [match.homeYellowCards,match.awayYellowCards]];
    predictions.push({ match, expected: analysis.expectedTotalCorners, actual: match.homeCorners + match.awayCorners,
      probabilities: Object.fromEntries(lines.map((line) => [String(line), analysis.probabilities[String(line)]!.over])),
      confidence: analysis.modelConfidence, quality: analysis.dataQuality.status,
      missingDataRate: supportingFields.filter((values) => values.some((value) => value == null)).length / supportingFields.length,
      homeSample: analysis.sample.home, awaySample: analysis.sample.away, distribution: analysis.distribution });
  }
  const binary = predictions.flatMap((item) => lines.map((line) => ({ probability: item.probabilities[String(line)]!,
    hit: item.actual > line ? 1 : 0, line })));
  const brier = binary.length ? binary.reduce((sum, item) => sum + (item.probability - item.hit) ** 2, 0) / binary.length : 0;
  const logLoss = binary.length ? -binary.reduce((sum, item) => { const p = safeProbability(item.probability);
    return sum + item.hit * Math.log(p) + (1 - item.hit) * Math.log(1 - p); }, 0) / binary.length : 0;
  const calibration = Object.fromEntries(calibrationBuckets.map((bucket) => {
    const entries = binary.filter((item) => item.probability >= bucket.min && item.probability < bucket.max);
    const actualHitRate = entries.length ? entries.reduce((sum, item) => sum + item.hit, 0) / entries.length : 0;
    const averagePredictedProbability = entries.length ? entries.reduce((sum, item) => sum + item.probability, 0) / entries.length : 0;
    return [bucket.name, { count: entries.length, predictions: entries.length, actualHitRate, averagePredictedProbability,
      expectedProbability: averagePredictedProbability, absoluteCalibrationError: entries.length ? Math.abs(actualHitRate - averagePredictedProbability) : 0,
      calibrationError: entries.length ? actualHitRate - averagePredictedProbability : 0 }];
  }));
  const thresholdMetrics = Object.fromEntries(lines.map((line) => {
    const entries = binary.filter((item) => item.line === line);
    const averagePredictedProbability = entries.length ? entries.reduce((sum, item) => sum + item.probability, 0) / entries.length : 0;
    const actualHitRate = entries.length ? entries.reduce((sum, item) => sum + item.hit, 0) / entries.length : 0;
    return [String(line), { predictions: entries.length, averagePredictedProbability, actualHitRate,
      calibrationError: actualHitRate - averagePredictedProbability,
      brier: entries.length ? entries.reduce((sum, item) => sum + (item.probability - item.hit) ** 2, 0) / entries.length : 0,
      logLoss: entries.length ? -entries.reduce((sum, item) => { const p = safeProbability(item.probability);
        return sum + item.hit * Math.log(p) + (1 - item.hit) * Math.log(1 - p); }, 0) / entries.length : 0 }];
  }));
  const confidencePerformance = Object.fromEntries(confidenceBuckets.map((bucket) =>
    [bucket.name, performance(predictions.filter((item) => item.confidence >= bucket.min && item.confidence < bucket.max))]));
  const qualityPerformance = Object.fromEntries((['POOR','LIMITED','GOOD','EXCELLENT'] as const).map((quality) => {
    const entries = predictions.filter((item) => item.quality === quality);
    const metrics = performance(entries);
    return [quality, { ...metrics, missingDataRate: entries.length ? entries.reduce((sum, item) => sum + item.missingDataRate, 0) / entries.length : 0 }];
  }));
  const calibrationEntries = Object.entries(calibration).filter(([, value]) => value.count > 0);
  const bestCalibratedRange = calibrationEntries.sort((a, b) => a[1].absoluteCalibrationError - b[1].absoluteCalibrationError)[0]?.[0] ?? null;
  const diagnostics = [...predictions].sort((a, b) => Math.abs(b.expected - b.actual) - Math.abs(a.expected - a.actual)).slice(0, 20)
    .map((item) => ({ matchId: item.match.matchId, match: `${item.match.homeTeamName ?? item.match.homeTeamId} - ${item.match.awayTeamName ?? item.match.awayTeamId}`,
      league: item.match.competitionName ?? item.match.competitionId, date: item.match.kickoffAt.toISOString(), expected: item.expected,
      actual: item.actual, absoluteError: Math.abs(item.expected - item.actual), homeSample: item.homeSample, awaySample: item.awaySample,
      distribution: item.distribution, dataQuality: item.quality, confidence: item.confidence }));
  const absoluteErrors = predictions.map((item) => Math.abs(item.expected - item.actual));
  const squaredErrors = predictions.map((item) => (item.expected - item.actual) ** 2);
  return {
    totalHistoricalMatches: sorted.length, eligible: sorted.length - skippedMissingCorners, matchesAnalyzed: predictions.length,
    matchesSkipped: skippedMissingCorners + skippedInsufficientHistory,
    skipped: { MISSING_CORNERS: skippedMissingCorners, SKIPPED_INSUFFICIENT_HISTORY: skippedInsufficientHistory },
    avgExpectedCorners: predictions.length ? predictions.reduce((sum, item) => sum + item.expected, 0) / predictions.length : 0,
    actualAvgCorners: predictions.length ? predictions.reduce((sum, item) => sum + item.actual, 0) / predictions.length : 0,
    mae: absoluteErrors.length ? absoluteErrors.reduce((a, b) => a + b, 0) / absoluteErrors.length : 0,
    rmse: squaredErrors.length ? Math.sqrt(squaredErrors.reduce((a, b) => a + b, 0) / squaredErrors.length) : 0,
    brier, logLoss, thresholdMetrics, calibration, bestCalibratedRange, qualityPerformance, confidencePerformance,
    diagnostics, chronologicalViolations,
  };
}
