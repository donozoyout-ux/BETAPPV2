import type { CornerModelConfig } from './config.js';
import type { LeagueCornerBaseline } from './types.js';

function poissonCdf(k: number, mean: number): number {
  let term = Math.exp(-mean);
  let sum = term;
  for (let i = 1; i <= k; i += 1) { term *= mean / i; sum += term; }
  return Math.min(1, sum);
}

function negativeBinomialCdf(k: number, mean: number, variance: number): number {
  if (variance <= mean) return poissonCdf(k, mean);
  const r = (mean * mean) / (variance - mean);
  const p = r / (r + mean);
  let term = p ** r;
  let sum = term;
  for (let i = 1; i <= k; i += 1) {
    term *= ((i - 1 + r) / i) * (1 - p);
    sum += term;
  }
  return Math.min(1, sum);
}

export function chooseDistribution(config: CornerModelConfig, baseline: LeagueCornerBaseline): 'POISSON' | 'NEGATIVE_BINOMIAL' {
  if (config.distribution !== 'AUTO') return config.distribution;
  return baseline.sampleSize >= config.minimumDistributionSample &&
    baseline.varianceTotalCorners > baseline.avgTotalCorners * config.overdispersionRatio
    ? 'NEGATIVE_BINOMIAL' : 'POISSON';
}

export function overProbability(line: number, expected: number, distribution: 'POISSON' | 'NEGATIVE_BINOMIAL', variance: number): number {
  const threshold = Math.floor(line);
  const cdf = distribution === 'NEGATIVE_BINOMIAL'
    ? negativeBinomialCdf(threshold, expected, Math.max(variance, expected + 0.0001))
    : poissonCdf(threshold, expected);
  return Math.max(0, Math.min(1, 1 - cdf));
}
