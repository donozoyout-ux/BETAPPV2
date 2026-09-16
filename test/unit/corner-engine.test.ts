import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../src/corners/backtest.js';
import { configHash, cornerModelConfig } from '../../src/corners/config.js';
import { chooseDistribution, overProbability } from '../../src/corners/distributions.js';
import { analyzeCorners } from '../../src/corners/engine.js';
import { buildLeagueBaseline, buildTeamProfile } from '../../src/corners/profiles.js';
import { calculateDataQuality, calculateModelConfidence } from '../../src/corners/quality.js';
import { shrink } from '../../src/corners/statistics.js';
import type { HistoricalCornerMatch } from '../../src/corners/types.js';

function match(index: number, overrides: Partial<HistoricalCornerMatch> = {}): HistoricalCornerMatch {
  return {
    matchId: `m${index}`, competitionId: 'league', season: '2026/27',
    kickoffAt: new Date(Date.UTC(2026, 0, index + 1)), homeTeamId: index % 2 ? 'away' : 'home',
    awayTeamId: index % 2 ? 'home' : 'away', homeGoals: 1, awayGoals: 0,
    homeCorners: 4 + (index % 4), awayCorners: 3 + (index % 3),
    firstHalfHomeCorners: null, firstHalfAwayCorners: null,
    homeXg: 1.2, awayXg: 0.8, homeShots: 12, awayShots: 9, homeShotsOnTarget: 5, awayShotsOnTarget: 3,
    homePossession: 55, awayPossession: 45, homeFouls: 10, awayFouls: 12, homeYellowCards: 2,
    awayYellowCards: 3, homeRedCards: 0, awayRedCards: 0, provider: 'fotmob', sourceTimestamp: new Date(),
    ...overrides,
  };
}

const history = Array.from({ length: 30 }, (_, index) => match(index));

describe('Corner Engine V1', () => {
  it('calculates rolling last5/last10 and home/away splits', () => {
    const last5 = buildTeamProfile(history, 'home', 'league', '2026/27', 'LAST_5', 'HOME');
    const last10 = buildTeamProfile(history, 'home', 'league', '2026/27', 'LAST_10', 'HOME');
    const away = buildTeamProfile(history, 'home', 'league', '2026/27', 'LAST_5', 'AWAY');
    expect(last5.sampleSize).toBe(5);
    expect(last10.sampleSize).toBe(10);
    expect(away.sampleSize).toBe(5);
    expect(last5.cornersForAvg).not.toBe(away.cornersForAvg);
  });

  it('calculates league baseline and over rates', () => {
    const baseline = buildLeagueBaseline(history, 'league', '2026/27');
    expect(baseline.sampleSize).toBe(30);
    expect(baseline.avgTotalCorners).toBeGreaterThan(7);
    expect(baseline.overRates['7.5']).toBeGreaterThanOrEqual(0);
    expect(baseline.varianceTotalCorners).toBeGreaterThan(0);
  });

  it('shrinks small samples toward the league prior', () => {
    expect(shrink(10, 1, 5, 10)).toBeCloseTo(5.4545, 3);
    expect(shrink(10, 100, 5, 10)).toBeCloseTo(9.5454, 3);
  });

  it('produces deterministic expected home, away and total values', () => {
    const kickoffAt = new Date('2026-02-15T00:00:00Z');
    const baseline = buildLeagueBaseline(history, 'league', '2026/27', kickoffAt);
    const result = analyzeCorners({ match: { competitionId: 'league', season: '2026/27', kickoffAt,
      homeTeamId: 'home', awayTeamId: 'away' }, history, baseline }, cornerModelConfig);
    expect(result.expectedHomeCorners).toBeGreaterThan(0);
    expect(result.expectedAwayCorners).toBeGreaterThan(0);
    expect(result.expectedTotalCorners).toBeCloseTo(result.expectedHomeCorners + result.expectedAwayCorners, 10);
    expect(result.probabilities['9.5']!.over + result.probabilities['9.5']!.under).toBeCloseTo(1, 10);
  });

  it('calculates Poisson and Negative Binomial probabilities and AUTO selection', () => {
    const poisson = overProbability(9.5, 10, 'POISSON', 10);
    const negativeBinomial = overProbability(9.5, 10, 'NEGATIVE_BINOMIAL', 20);
    expect(poisson).toBeCloseTo(0.542, 2);
    expect(negativeBinomial).not.toBeCloseTo(poisson, 3);
    const baseline = buildLeagueBaseline(history, 'league', '2026/27');
    expect(chooseDistribution(cornerModelConfig, { ...baseline, sampleSize: 50, avgTotalCorners: 10, varianceTotalCorners: 20 })).toBe('NEGATIVE_BINOMIAL');
    expect(chooseDistribution(cornerModelConfig, { ...baseline, sampleSize: 50, avgTotalCorners: 10, varianceTotalCorners: 10 })).toBe('POISSON');
  });

  it('separates data quality from model confidence and handles missing data', () => {
    const quality = calculateDataQuality({ homeSample: 0, awaySample: 0, leagueSample: 0, recentHome: 0,
      recentAway: 0, cornerCompleteness: 0, consensusConfidence: 0, missingFields: ['home', 'away', 'league'] }, 45);
    const confidence = calculateModelConfidence({ homeSample: 20, awaySample: 20, variance: 10, mean: 10,
      venueAgreement: 0.5, recentConsistency: 0.5, teamLeagueDeviation: 1, distributionSample: 100 });
    expect(quality.status).toBe('POOR');
    expect(quality.analysisEligible).toBe(false);
    expect(confidence).toBeGreaterThan(quality.score);
  });

  it('prevents future leakage in analysis and chronological backtest', () => {
    const kickoffAt = new Date('2026-02-01T00:00:00Z');
    const baseline = buildLeagueBaseline(history, 'league', '2026/27', kickoffAt);
    const input = { match: { competitionId: 'league', season: '2026/27', kickoffAt, homeTeamId: 'home', awayTeamId: 'away' }, baseline };
    const withoutFuture = analyzeCorners({ ...input, history }, cornerModelConfig);
    const withFuture = analyzeCorners({ ...input, history: [...history, match(99, { kickoffAt: new Date('2027-01-01'), homeCorners: 99, awayCorners: 99 })] }, cornerModelConfig);
    expect(withFuture.expectedTotalCorners).toBe(withoutFuture.expectedTotalCorners);
    const report = runBacktest(history, cornerModelConfig);
    expect(report.chronologicalViolations).toBe(0);
    expect(report.totalHistoricalMatches).toBe(30);
    expect(report.skipped.SKIPPED_INSUFFICIENT_HISTORY).toBeGreaterThan(0);
    expect(report.thresholdMetrics['9.5']).toHaveProperty('averagePredictedProbability');
    expect(report.calibration).toHaveProperty('80-85');
    expect(report.qualityPerformance).toHaveProperty('LIMITED');
    expect(report.confidencePerformance).toHaveProperty('50-59');
    expect(report.diagnostics.length).toBeLessThanOrEqual(20);
  });

  it('versions configuration deterministically and changes hash when config changes', () => {
    const first = configHash(cornerModelConfig);
    expect(configHash(cornerModelConfig)).toBe(first);
    expect(configHash({ ...cornerModelConfig, shrinkageSample: 12 })).not.toBe(first);
    expect(cornerModelConfig.modelVersion).toBe('CORNER_V1');
  });
});
