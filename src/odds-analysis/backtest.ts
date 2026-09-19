import { analyzeOdds } from './engine.js';
import type { AnalysisConfig, OddsSnapshot } from './types.js';

export type HistoricalOddsMatch = {
  matchId: string; kickoffAt: Date; homeScore: number; awayScore: number; snapshots: OddsSnapshot[];
};

type Bucket = { sample: number; hits: number; hitRate: number | null };

function bucketize<T>(items: T[], key: (item: T) => string, hit: (item: T) => boolean): Record<string, Bucket> {
  const result: Record<string, { sample: number; hits: number }> = {};
  for (const item of items) {
    const name = key(item);
    const bucket = result[name] ?? { sample: 0, hits: 0 };
    bucket.sample += 1;
    if (hit(item)) bucket.hits += 1;
    result[name] = bucket;
  }
  return Object.fromEntries(Object.entries(result).map(([name, value]) =>
    [name, { ...value, hitRate: value.sample ? value.hits / value.sample : null }]));
}

function calibration(items: Array<{ item: { currentFairProbability: number }; hit: boolean }>) {
  const grouped = new Map<string, Array<{ item: { currentFairProbability: number }; hit: boolean }>>();
  for (const item of items) {
    const lower = Math.floor(item.item.currentFairProbability * 10) * 10;
    const name = `${lower}-${Math.min(100, lower + 9)}`;
    grouped.set(name, [...(grouped.get(name) ?? []), item]);
  }
  return Object.fromEntries([...grouped].map(([name, values]) => {
    const predicted = values.reduce((sum, value) => sum + value.item.currentFairProbability, 0) / values.length;
    const actual = values.filter((value) => value.hit).length / values.length;
    return [name, { sample: values.length, averagePredictedProbability: predicted, actualHitRate: actual,
      absoluteCalibrationError: Math.abs(predicted - actual) }];
  }));
}

export function runOddsBacktest(matches: HistoricalOddsMatch[], config: AnalysisConfig) {
  let totalInputSnapshots = 0;
  let preKickoffSnapshotsUsed = 0;
  let atOrAfterKickoffSnapshotsExcluded = 0;
  let unsafeSnapshotsUsed = 0;
  let matchesContainingAtOrAfterKickoffSnapshots = 0;
  const records = matches.flatMap((match) => {
    totalInputSnapshots += match.snapshots.length;
    if (match.snapshots.some((snapshot) => snapshot.capturedAt >= match.kickoffAt)) {
      matchesContainingAtOrAfterKickoffSnapshots += 1;
    }
    const result = analyzeOdds(match.matchId, match.kickoffAt, match.snapshots, { config, generatedAt: match.kickoffAt });
    preKickoffSnapshotsUsed += result.metadata.safeSnapshotCount;
    atOrAfterKickoffSnapshotsExcluded += result.metadata.excludedAfterKickoff;
    unsafeSnapshotsUsed += result.metadata.unsafeSnapshotsUsed;
    const outcome = match.homeScore > match.awayScore ? 'HOME' : match.homeScore < match.awayScore ? 'AWAY' : 'DRAW';
    return result.items.filter((item) => /1X2|MATCH.?RESULT|MAÇ.?SONUCU/i.test(`${item.marketType} ${item.marketName}`))
      .map((item) => ({ matchId: match.matchId, item, hit: item.selection === outcome }));
  });
  const eligible = records.filter((record) => record.item.analysisEligible);
  const supported = eligible.filter((record) => ['SUPPORT','STRONG_SUPPORT'].includes(record.item.movementClass));
  const opposed = eligible.filter((record) => ['OPPOSE','STRONG_OPPOSE'].includes(record.item.movementClass));
  const support = supported.filter((record) => record.item.movementClass === 'SUPPORT');
  const strongSupport = supported.filter((record) => record.item.movementClass === 'STRONG_SUPPORT');
  const scoreBucket = (score: number) => `${Math.floor(score / 10) * 10}-${Math.min(100, Math.floor(score / 10) * 10 + 9)}`;
  const countByClass = Object.fromEntries(['STRONG_SUPPORT','SUPPORT','NEUTRAL','OPPOSE','STRONG_OPPOSE']
    .map((name) => [name, eligible.filter((record) => record.item.movementClass === name).length]));
  return {
    modelVersion: config.modelVersion,
    totalCompletedMatches: matches.length,
    matchesWith1X2Analysis: new Set(records.map((record) => record.matchId)).size,
    eligibleMatches: new Set(eligible.map((record) => record.matchId)).size,
    eligibleSelectionEvents: eligible.length,
    supportSignalCount: support.length,
    strongSupportSignalCount: strongSupport.length,
    supportHitRate: support.length ? support.filter((record) => record.hit).length / support.length : null,
    strongSupportHitRate: strongSupport.length
      ? strongSupport.filter((record) => record.hit).length / strongSupport.length : null,
    oppositionSignalCount: opposed.length,
    movementClassCounts: countByClass,
    supportedSignalPerformance: {
      scoreBuckets: bucketize(supported, (record) => scoreBucket(record.item.score), (record) => record.hit),
      confidenceBuckets: bucketize(supported, (record) => scoreBucket(record.item.modelConfidence.score), (record) => record.hit),
      bookmakerCountBuckets: bucketize(supported, (record) => String(record.item.bookmakerCount), (record) => record.hit),
      dataQualityBuckets: bucketize(supported, (record) => record.item.dataQuality.grade, (record) => record.hit),
    },
    probabilityCalibration: {
      selectionEvents: eligible.length,
      brierScore: eligible.length ? eligible.reduce((sum, record) =>
        sum + (record.item.currentFairProbability - (record.hit ? 1 : 0)) ** 2, 0) / eligible.length : null,
      buckets: calibration(eligible),
    },
    leakageAudit: { totalInputSnapshots, preKickoffSnapshotsUsed, atOrAfterKickoffSnapshotsExcluded,
      matchesContainingAtOrAfterKickoffSnapshots, unsafeSnapshotsUsed },
    futureLeakageViolations: unsafeSnapshotsUsed,
    limitations: matches.length === 0
      ? ['No completed matches with historical odds were available; no results were fabricated.']
      : ['Hit rates describe outcomes only; profitability is not claimed. Closing-price and stake returns are not available.'],
  };
}
