import { buildOddsIntelligence } from './engine.js';
import type { HistoricalNeighborInput, MatchOutcomeData, OddsRoute } from './types.js';

export function chronologicalNeighborBacktest(records: Array<MatchOutcomeData & { route: OddsRoute }>) {
  const ordered = [...records].sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime() || a.matchId.localeCompare(b.matchId));
  const buckets = new Map<string, { targets: number; positive: number; baselinePositive: number; baselineN: number }>(); let targetsWithNeighbors = 0; let totalN = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const target = ordered[index]!; const earlier: HistoricalNeighborInput[] = ordered.slice(0, index).map((item) => ({ ...item }));
    const analysis = buildOddsIntelligence(target, earlier, { mode: 'CLOSEST_NEIGHBORS', limit: 30 }, target.kickoffAt);
    if (!analysis.pastTwins.length) continue; targetsWithNeighbors += 1; totalN += analysis.pastTwins.length;
    const row = analysis.evidenceGap.find((item) => item.market === target.route.marketType && item.selection === target.route.selection) ?? analysis.evidenceGap[0];
    if (!row) continue; const key = analysis.pastTwins.length < 10 ? '5-9' : analysis.pastTwins.length < 20 ? '10-19' : analysis.pastTwins.length < 50 ? '20-49' : '50+';
    const bucket = buckets.get(key) ?? { targets: 0, positive: 0, baselinePositive: 0, baselineN: 0 }; bucket.targets += 1; bucket.positive += row.positiveCount; bucket.baselinePositive += Math.round((row.baselineRate ?? 0) * row.baselineSampleSize); bucket.baselineN += row.baselineSampleSize; buckets.set(key, bucket);
  }
  return { targets: ordered.length, targetsWithNeighbors, averageNeighborN: targetsWithNeighbors ? totalN / targetsWithNeighbors : 0,
    buckets: [...buckets.entries()].map(([bucket, value]) => ({ bucket, ...value, positiveRate: value.targets ? value.positive / value.targets : null, baselineRate: value.baselineN ? value.baselinePositive / value.baselineN : null })) };
}
