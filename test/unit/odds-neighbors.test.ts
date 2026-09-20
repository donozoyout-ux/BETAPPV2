import { describe, expect, it } from 'vitest';
import { evidenceGaps, wilsonInterval } from '../../src/odds-neighbors/baseline.js';
import { chronologicalNeighborBacktest } from '../../src/odds-neighbors/backtest.js';
import { buildOddsIntelligence, calculateEvidenceStrength, findPastTwins } from '../../src/odds-neighbors/engine.js';
import { buildOddsRoute } from '../../src/odds-neighbors/features.js';
import { buildResultMap } from '../../src/odds-neighbors/result-map.js';
import type { HistoricalNeighborInput, MatchOutcomeData } from '../../src/odds-neighbors/types.js';

const kickoff = new Date('2030-01-02T18:00:00Z');
function snapshots(matchId: string, over = [2.05, 1.91], times = ['2030-01-01T10:00:00Z','2030-01-01T12:00:00Z']) {
  return times.flatMap((time, index) => ['book-a','book-b'].flatMap((provider, providerIndex) => [
    { matchId, provider, marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection: 'OVER', oddsDecimal: over[index]! + providerIndex * 0.01, capturedAt: new Date(time) },
    { matchId, provider, marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection: 'UNDER', oddsDecimal: 1.8 - index * 0.03 + providerIndex * 0.01, capturedAt: new Date(time) },
  ]));
}
function route(matchId: string, over?: number[]) {
  const cutoff = new Date('2031-01-02T18:00:00Z');
  return buildOddsRoute(matchId, cutoff, snapshots(matchId, over), 'TOTAL_GOALS', 'Total Goals', 2.5, 'OVER', cutoff)!;
}
function match(matchId: string, date: string, scores: [number | null, number | null] = [2,1]): MatchOutcomeData {
  return { matchId, competitionId: 'league-1', kickoffAt: new Date(date), league: 'Test League', homeTeam: `${matchId} Home`, awayTeam: `${matchId} Away`,
    homeScore: scores[0], awayScore: scores[1], firstHalfHomeScore: null, firstHalfAwayScore: null,
    homeCorners: 5, awayCorners: 5, homeYellowCards: 1, awayYellowCards: 2, homeRedCards: 0, awayRedCards: 0 };
}

describe('Odds Neighbor Engine V2', () => {
  it('builds a route only from genuine snapshots and computes deterministic features', () => {
    const all = snapshots('m1', [2.05, 1.98, 1.91], ['2030-01-01T10:00:00Z','2030-01-01T11:00:00Z','2030-01-01T12:00:00Z']);
    const value = buildOddsRoute('m1', kickoff, all, 'TOTAL_GOALS', 'Total Goals', 2.5, 'OVER', kickoff)!;
    expect(value.snapshots.map((item) => item.capturedAt.toISOString())).toEqual(['2030-01-01T10:00:00.000Z','2030-01-01T11:00:00.000Z','2030-01-01T12:00:00.000Z']);
    expect(value.genuineObservations).toBe(3);
    expect(value.openingOdds).toBeCloseTo(2.055, 4);
    expect(value.latestOdds).toBeCloseTo(1.915, 4);
    expect(value.direction).toBe('UP');
    expect(value.totalMovementPp).toBeGreaterThan(0);
    expect(value.monotonicityRatio).toBe(1);
  });

  it('ranks each closest neighbor independently and supports a separate odds-band meaning', () => {
    const target = route('target');
    const near: HistoricalNeighborInput = { ...match('near', '2029-01-01T18:00:00Z'), route: route('near', [2.04,1.92]) };
    const far: HistoricalNeighborInput = { ...match('far', '2028-01-01T18:00:00Z'), route: route('far', [3.2,2.9]) };
    const closest = findPastTwins({ competitionId: 'league-1', route: target }, [far, near], { mode: 'CLOSEST_NEIGHBORS', limit: 2 });
    expect(closest.map((item) => item.matchId)).toEqual(['near','far']);
    expect(closest[0]!.similarity).toBeGreaterThan(closest[1]!.similarity);
    const band = findPastTwins({ competitionId: 'league-1', route: target }, [far, near], { mode: 'ODDS_BAND', limit: 10, bandPercent: 0.05 });
    expect(band.map((item) => item.matchId)).toEqual(['near']);
  });

  it('maps score/corner/card results with the actual available denominator', () => {
    const missing = { ...match('missing', '2029-01-02T18:00:00Z', [0,0]), homeCorners: null, awayCorners: null, homeYellowCards: null, awayYellowCards: null, homeRedCards: null, awayRedCards: null };
    const rows = buildResultMap([match('one', '2029-01-01T18:00:00Z'), missing]);
    expect(rows.find((row) => row.market === 'TOTAL_GOALS' && row.line === 2.5 && row.selection === 'OVER')).toMatchObject({ sampleSize: 2, positiveCount: 1, missingCount: 0 });
    expect(rows.find((row) => row.market === 'TOTAL_CORNERS' && row.line === 8.5 && row.selection === 'OVER')).toMatchObject({ sampleSize: 1, positiveCount: 1, missingCount: 1 });
    expect(rows.find((row) => row.market === 'TOTAL_CARDS' && row.line === 2.5 && row.selection === 'OVER')).toMatchObject({ sampleSize: 1, positiveCount: 1, missingCount: 1 });
    expect(rows.some((row) => row.market === 'FIRST_HALF_GOALS')).toBe(false);
  });

  it('uses same-competition baselines when sufficient and Wilson uncertainty for evidence', () => {
    const neighbors = Array.from({ length: 5 }, (_, index) => ({ ...match(`n${index}`, `2029-01-0${index + 1}T18:00:00Z`, [2,1]) }));
    const global = [...neighbors, ...Array.from({ length: 20 }, (_, index) => ({ ...match(`g${index}`, `2028-02-${String(index + 1).padStart(2,'0')}T18:00:00Z`, [0,0]), competitionId: 'league-2' }))];
    const gap = evidenceGaps(neighbors, global, 'league-1', 5).find((row) => row.market === 'TOTAL_GOALS' && row.line === 2.5 && row.selection === 'OVER')!;
    expect(gap).toMatchObject({ baselineScope: 'SAME_COMPETITION', sampleSize: 5, positiveCount: 5, baselineSampleSize: 5 });
    expect(gap.wilson.lower).toBeLessThan(1);
    expect(evidenceGaps(neighbors, global, 'league-1', 6).find((row) => row.market === 'TOTAL_GOALS' && row.line === 2.5 && row.selection === 'OVER'))
      .toMatchObject({ baselineScope: 'GLOBAL_SUPPORTED_COMPETITIONS', baselineSampleSize: 25 });
    expect(wilsonInterval(0, 0)).toEqual({ lower: null, upper: null });
  });

  it('excludes future candidates, does not use results as route inputs, and keeps conflict explanatory', () => {
    const targetData = match('target', '2030-01-02T18:00:00Z'); const targetRoute = route('target');
    const earlier: HistoricalNeighborInput = { ...match('earlier', '2029-01-01T18:00:00Z'), route: route('earlier') };
    const future: HistoricalNeighborInput = { ...match('future', '2031-01-01T18:00:00Z'), route: route('future') };
    const analysis = buildOddsIntelligence({ ...targetData, route: targetRoute }, [earlier, future], { mode: 'CLOSEST_NEIGHBORS', limit: 10 }, targetData.kickoffAt);
    expect(analysis.pastTwins.map((item) => item.matchId)).toEqual(['earlier']);
    expect(analysis.executionAuthority).toBe(false);
    expect(analysis.aiPredictionAuthority).toBe(false);
    expect(analysis.conflictCheck.find((item) => item.source === 'XG')?.state).toBe('UNAVAILABLE');
    expect(calculateEvidenceStrength(analysis.pastTwins, analysis.evidenceGap, 1)).toBe('VERY_LOW');
  });

  it('chronological backtest only offers earlier records as candidates', () => {
    const records = [
      { ...match('a', '2028-01-01T18:00:00Z'), route: route('a') },
      { ...match('b', '2029-01-01T18:00:00Z'), route: route('b') },
    ];
    const report = chronologicalNeighborBacktest(records);
    expect(report).toMatchObject({ targets: 2, targetsWithNeighbors: 1 });
  });
});
