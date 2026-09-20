import { buildOddsIntelligence } from './engine.js';
import { buildResultMap } from './result-map.js';
import type { HistoricalNeighborInput, MatchOutcomeData, OddsRoute } from './types.js';

type Aggregate = {
  targets: number;
  evaluableTargets: number;
  positiveTargets: number;
  neighborNSum: number;
  baselineRateSum: number;
  baselineRateCount: number;
};

function emptyAggregate(): Aggregate {
  return { targets: 0, evaluableTargets: 0, positiveTargets: 0, neighborNSum: 0, baselineRateSum: 0, baselineRateCount: 0 };
}

function bucketName(neighbors: number): string {
  if (neighbors < 5) return '1-4';
  if (neighbors < 10) return '5-9';
  if (neighbors < 20) return '10-19';
  if (neighbors < 50) return '20-49';
  return '50+';
}

function marketKey(route: OddsRoute): string {
  return `${route.marketType}|${route.marketName}|${route.line ?? 'null'}|${route.selection}`;
}

function targetOutcome(target: MatchOutcomeData & { route: OddsRoute }): boolean | null {
  const row = buildResultMap([target]).find((item) =>
    item.market === target.route.marketType
    && item.selection === target.route.selection
    && item.line === target.route.line);
  if (!row || row.sampleSize !== 1) return null;
  return row.positiveCount === 1;
}

function finalize(value: Aggregate) {
  const positiveRate = value.evaluableTargets ? value.positiveTargets / value.evaluableTargets : null;
  const baselineRate = value.baselineRateCount ? value.baselineRateSum / value.baselineRateCount : null;
  return {
    targets: value.targets,
    evaluableTargets: value.evaluableTargets,
    positiveTargets: value.positiveTargets,
    targetPositiveRate: positiveRate,
    averageBaselineRate: baselineRate,
    realizedGapPp: positiveRate == null || baselineRate == null ? null : (positiveRate - baselineRate) * 100,
    averageNeighborN: value.targets ? value.neighborNSum / value.targets : 0,
  };
}

/**
 * Chronological replay: each target may only use matches that kicked off earlier.
 * Reported positive rates are the ACTUAL target outcomes, not the historical
 * neighbors' positive counts.
 */
export function chronologicalNeighborBacktest(records: Array<MatchOutcomeData & { route: OddsRoute }>) {
  const ordered = [...records].sort((a, b) =>
    a.kickoffAt.getTime() - b.kickoffAt.getTime() || a.matchId.localeCompare(b.matchId));
  const buckets = new Map<string, Aggregate>();
  const markets = new Map<string, Aggregate>();
  const evidenceStrength = new Map<string, number>();
  let targetsWithNeighbors = 0;
  let totalNeighborN = 0;
  let evaluableTargets = 0;
  let positiveTargets = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const target = ordered[index]!;
    const earlier: HistoricalNeighborInput[] = ordered.slice(0, index).map((item) => ({ ...item }));
    const analysis = buildOddsIntelligence(
      target,
      earlier,
      { mode: 'CLOSEST_NEIGHBORS', limit: 30 },
      target.kickoffAt,
    );
    if (!analysis.pastTwins.length) continue;

    targetsWithNeighbors += 1;
    totalNeighborN += analysis.pastTwins.length;
    evidenceStrength.set(analysis.evidenceStrength, (evidenceStrength.get(analysis.evidenceStrength) ?? 0) + 1);

    const actual = targetOutcome(target);
    const evidenceRow = analysis.evidenceGap.find((item) =>
      item.market === target.route.marketType
      && item.selection === target.route.selection
      && item.line === target.route.line);

    if (actual != null) {
      evaluableTargets += 1;
      if (actual) positiveTargets += 1;
    }

    for (const [key, aggregate] of [
      [bucketName(analysis.pastTwins.length), buckets.get(bucketName(analysis.pastTwins.length)) ?? emptyAggregate()],
      [marketKey(target.route), markets.get(marketKey(target.route)) ?? emptyAggregate()],
    ] as const) {
      aggregate.targets += 1;
      aggregate.neighborNSum += analysis.pastTwins.length;
      if (actual != null) {
        aggregate.evaluableTargets += 1;
        if (actual) aggregate.positiveTargets += 1;
        if (evidenceRow?.baselineRate != null) {
          aggregate.baselineRateSum += evidenceRow.baselineRate;
          aggregate.baselineRateCount += 1;
        }
      }
      if (key.includes('|')) markets.set(key, aggregate);
      else buckets.set(key, aggregate);
    }
  }

  return {
    targets: ordered.length,
    targetsWithNeighbors,
    targetCoverageRate: ordered.length ? targetsWithNeighbors / ordered.length : 0,
    evaluableTargets,
    positiveTargets,
    targetPositiveRate: evaluableTargets ? positiveTargets / evaluableTargets : null,
    averageNeighborN: targetsWithNeighbors ? totalNeighborN / targetsWithNeighbors : 0,
    buckets: [...buckets.entries()].map(([bucket, value]) => ({ bucket, ...finalize(value) })),
    markets: [...markets.entries()].map(([market, value]) => ({ market, ...finalize(value) }))
      .sort((a, b) => b.targets - a.targets || a.market.localeCompare(b.market)),
    evidenceStrength: Object.fromEntries([...evidenceStrength.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}
