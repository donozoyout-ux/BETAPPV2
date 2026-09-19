import { describe, expect, it } from 'vitest';
import { calculateConsensus, median } from '../../src/odds-analysis/consensus.js';
import { configHash, defaultConfig } from '../../src/odds-analysis/config.js';
import { analyzeOdds } from '../../src/odds-analysis/engine.js';
import { runOddsBacktest } from '../../src/odds-analysis/backtest.js';
import { buildBookmakerMarkets } from '../../src/odds-analysis/movement.js';
import { fairProbability, normalize1X2, normalizeTwoWay, overround, rawProbability } from '../../src/odds-analysis/probability.js';
import type { BookmakerSelectionMovement, OddsSnapshot } from '../../src/odds-analysis/types.js';

const kickoff = new Date('2026-09-20T18:00:00Z');
const openingAt = new Date('2026-09-20T12:00:00Z');
const currentAt = new Date('2026-09-20T17:30:00Z');

function snapshot(provider: string, selection: string, oddsDecimal: number, capturedAt: Date,
  marketType = '1X2', line: number | null = null): OddsSnapshot {
  return { matchId: 'm1', provider, marketType, marketName: marketType, line, selection, oddsDecimal, capturedAt };
}

function market(provider: string, opening = [2.1, 3.3, 3.6], current = [1.85, 3.5, 4.2],
  marketType = '1X2', line: number | null = null): OddsSnapshot[] {
  return ['HOME','DRAW','AWAY'].flatMap((selection, index) => [
    snapshot(provider, selection, opening[index]!, openingAt, marketType, line),
    snapshot(provider, selection, current[index]!, currentAt, marketType, line),
  ]);
}

describe('ODDS ANALYSIS V1 probability', () => {
  it('converts decimal odds, calculates overround and removes margin for 1X2', () => {
    expect(rawProbability(2)).toBe(0.5);
    expect(overround([0.5, 0.3, 0.25])).toBe(1.05);
    expect(fairProbability(0.5, 1.05)).toBeCloseTo(0.47619);
    const result = normalize1X2(2.1, 3.3, 3.6);
    expect(result.home + result.draw + result.away).toBeCloseTo(1, 12);
    expect(result.overround).toBeGreaterThan(1);
  });

  it('normalizes complete two-way markets to one', () => {
    const result = normalizeTwoWay(1.9, 1.95);
    expect(result.over + result.under).toBeCloseTo(1, 12);
  });
});

describe('ODDS ANALYSIS V1 movement and consensus', () => {
  it('maps falling odds to rising fair probability and rising odds to falling probability', () => {
    const movements = buildBookmakerMarkets(market('bet365'))[0]!.movements;
    expect(movements.find((item) => item.selection === 'HOME')!.rawOddsMovementPercent).toBeLessThan(0);
    expect(movements.find((item) => item.selection === 'HOME')!.probabilityDeltaPp).toBeGreaterThan(0);
    expect(movements.find((item) => item.selection === 'AWAY')!.rawOddsMovementPercent).toBeGreaterThan(0);
    expect(movements.find((item) => item.selection === 'AWAY')!.probabilityDeltaPp).toBeLessThan(0);
  });

  it('selects chronological opening/current states and keeps market lines isolated', () => {
    const twoWay = (provider: string, line: number, start: [number, number], end: [number, number]) =>
      ['OVER','UNDER'].flatMap((selection, index) => [snapshot(provider, selection, start[index]!, openingAt, 'TOTAL_GOALS', line),
        snapshot(provider, selection, end[index]!, currentAt, 'TOTAL_GOALS', line)]);
    const groups = buildBookmakerMarkets([...twoWay('p1', 2.5, [2, 1.8], [1.8, 2]),
      ...twoWay('p1', 3.5, [3, 1.4], [3.2, 1.35])]);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.line === 2.5)!.movements[0]!.openingCapturedAt).toEqual(openingAt);
    expect(groups.find((group) => group.line === 2.5)!.movements[0]!.currentCapturedAt).toEqual(currentAt);
  });

  it('uses a true median and gives each bookmaker exactly one vote', () => {
    expect(median([1, 2, 100, 3])).toBe(2.5);
    const vote = (provider: string, delta: number): BookmakerSelectionMovement => ({ provider, marketType: '1X2',
      marketName: '1X2', line: null, selection: 'HOME', openingOdds: 2, currentOdds: 1.9, highestOdds: 2,
      lowestOdds: 1.9, snapshotCount: provider === 'noisy' ? 100 : 2, openingFairProbability: 0.45,
      minimumMarketSelectionSnapshotCount: 2, completeStateCount: 2, openingCompleteAt: openingAt,
      currentCompleteAt: currentAt, hasDistinctCompleteStates: true,
      currentFairProbability: 0.45 + delta / 100, probabilityDeltaPp: delta, rawOddsMovementPercent: -5,
      openingCapturedAt: openingAt, currentCapturedAt: currentAt });
    const result = calculateConsensus([vote('noisy', 8), vote('noisy', 9), vote('p2', 4), vote('p3', -1)]);
    expect(result.bookmakerCount).toBe(3);
    expect(result.agreeingBookmakerCount).toBe(2);
    expect(result.movementAgreementRatio).toBeCloseTo(2 / 3);
    expect(result.probabilityDispersion).toBeGreaterThanOrEqual(0);
  });
});

describe('ODDS ANALYSIS V1 safety and quality', () => {
  it('supports 1X2 consensus and deterministic repeated analysis', () => {
    const data = [...market('bet365'), ...market('pinnacle', [2.08,3.35,3.7], [1.83,3.55,4.25]),
      ...market('williamhill', [2.12,3.25,3.55], [1.88,3.45,4.1])];
    const first = analyzeOdds('m1', kickoff, data, { generatedAt: new Date('2026-09-20T17:40:00Z') });
    const second = analyzeOdds('m1', kickoff, [...data].reverse(), { generatedAt: new Date('2026-09-20T17:40:00Z') });
    const home = first.items.find((item) => item.selection === 'HOME')!;
    expect(home.bookmakerCount).toBe(3);
    expect(home.probabilityDeltaPp).toBeGreaterThan(0);
    expect(home.movementClass).toMatch(/SUPPORT/);
    expect(home.score).toBeGreaterThan(0);
    expect(Object.values(home.scoreComponents).reduce((sum, value) => sum + value, 0)).toBeCloseTo(home.score);
    expect(second.inputHash).toBe(first.inputHash);
    expect(second.items).toEqual(first.items);
  });

  it('downgrades stale and insufficient coverage, and POOR quality is ineligible', () => {
    const stale = market('only-one').map((item) => ({ ...item, capturedAt: new Date(item.capturedAt.getTime() - 86_400_000) }));
    const result = analyzeOdds('m1', kickoff, stale, { generatedAt: new Date('2026-09-20T17:40:00Z') });
    expect(result.items[0]!.warnings.join(' ')).toMatch(/only 1 bookmakers|stale/);
    expect(result.items[0]!.dataQuality.grade).toBe('POOR');
    expect(result.items[0]!.analysisEligible).toBe(false);
  });

  it('marks missing opening/incomplete markets ineligible', () => {
    const result = analyzeOdds('m1', kickoff, [snapshot('p1', 'HOME', 2, currentAt)],
      { generatedAt: new Date('2026-09-20T17:40:00Z') });
    expect(result.items).toEqual([]);
    expect(result.dataQuality.grade).toBe('POOR');
    expect(result.metadata.incompleteMarketCount).toBe(1);
  });

  it('does not treat a single complete state as safe opening/current movement', () => {
    const oneState = ['p1','p2','p3'].flatMap((provider) => ['HOME','DRAW','AWAY']
      .map((selection, index) => snapshot(provider, selection, [2.1,3.3,3.6][index]!, currentAt)));
    const result = analyzeOdds('m1', kickoff, oneState, { generatedAt: new Date('2026-09-20T17:40:00Z') });
    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => !item.analysisEligible)).toBe(true);
    expect(result.items[0]!.warnings.join(' ')).toMatch(/opening\/current/);
  });

  it('does not promote repeated snapshots for only one selection into complete state coverage', () => {
    const opening = ['HOME','DRAW','AWAY'].map((selection, index) =>
      snapshot('p1', selection, [2.1,3.3,3.6][index]!, openingAt));
    const repeatedHome = [new Date('2026-09-20T13:00:00Z'), new Date('2026-09-20T14:00:00Z')]
      .map((capturedAt, index) => snapshot('p1', 'HOME', 2 - index * 0.05, capturedAt));
    const marketState = buildBookmakerMarkets([...opening, ...repeatedHome])[0]!;
    expect(marketState.completeStateCount).toBeGreaterThan(1);
    expect(marketState.hasDistinctCompleteStates).toBe(false);
    expect(marketState.movements.every((movement) => movement.minimumMarketSelectionSnapshotCount === 1)).toBe(true);
  });

  it('strictly excludes snapshots at or after kickoff and prevents future leakage', () => {
    const safe = [...market('p1'), ...market('p2'), ...market('p3')];
    const baseline = analyzeOdds('m1', kickoff, safe, { generatedAt: new Date('2026-09-21T00:00:00Z') });
    const leaked = analyzeOdds('m1', kickoff, [...safe,
      snapshot('p1', 'HOME', 1.01, new Date('2026-09-20T18:00:00Z')),
      snapshot('p1', 'DRAW', 50, new Date('2026-09-20T18:00:00Z')),
      snapshot('p1', 'AWAY', 50, new Date('2026-09-20T18:00:00Z'))], { generatedAt: new Date('2026-09-21T00:00:00Z') });
    expect(leaked.items).toEqual(baseline.items.map((item) => ({ ...item,
      warnings: [...item.warnings, '3 snapshot(s) at/after kickoff were excluded'] })));
    expect(leaked.inputHash).toBe(baseline.inputHash);
    expect(leaked.metadata.excludedAfterKickoff).toBe(3);
  });

  it('hashes configuration deterministically and never grants execution authority', () => {
    expect(configHash(defaultConfig)).toBe(configHash({ ...defaultConfig }));
    expect(configHash({ ...defaultConfig, minimumBookmakerCount: 4 })).not.toBe(configHash(defaultConfig));
    const result = analyzeOdds('m1', kickoff, [], { generatedAt: openingAt });
    expect(result.metadata.executionAuthority).toBe(false);
  });

  it('supports two-way corner and Asian lines without blending the Corner Engine score', () => {
    const twoWay = (provider: string, type: string, line: number, selections: [string, string]) =>
      selections.flatMap((selection, index) => [
        snapshot(provider, selection, index ? 1.9 : 2, openingAt, type, line),
        snapshot(provider, selection, index ? 2.05 : 1.82, currentAt, type, line),
      ]);
    const cornerData = ['p1','p2','p3'].flatMap((provider) => twoWay(provider, 'TOTAL_CORNERS', 9.5, ['OVER','UNDER']));
    const corner = analyzeOdds('m1', kickoff, cornerData, { generatedAt: new Date('2026-09-20T17:40:00Z'),
      cornerComparison: { qualityGrade: 'GOOD', probabilities: { '9.5': { over: 0.62, under: 0.38 } } } });
    const over = corner.items.find((item) => item.selection === 'OVER')!;
    expect(over.modelMarketGapPp).not.toBeNull();
    expect(over.scoreComponents).not.toHaveProperty('cornerEngine');

    const asianData = ['p1','p2','p3'].flatMap((provider) =>
      twoWay(provider, 'ASIAN_HANDICAP', -0.5, ['HOME','AWAY']));
    const asian = analyzeOdds('m1', kickoff, asianData, { generatedAt: new Date('2026-09-20T17:40:00Z') });
    expect(asian.items.map((item) => item.selection).sort()).toEqual(['AWAY','HOME']);
    expect(asian.items.every((item) => item.line === -0.5)).toBe(true);
  });

  it('separates signal hit rates from calibration and computes leakage evidence', () => {
    const preMatch = [...market('p1'), ...market('p2'), ...market('p3')];
    const afterKickoff = ['HOME','DRAW','AWAY'].map((selection, index) =>
      snapshot('p1', selection, [1.01,20,20][index]!, new Date('2026-09-20T18:01:00Z')));
    const report = runOddsBacktest([{ matchId: 'm1', kickoffAt: kickoff, homeScore: 2, awayScore: 0,
      snapshots: [...preMatch, ...afterKickoff] }], defaultConfig);
    expect(report.eligibleMatches).toBe(1);
    expect(report.eligibleSelectionEvents).toBe(3);
    expect(report.supportSignalCount + report.strongSupportSignalCount).toBeGreaterThan(0);
    expect(report.probabilityCalibration.selectionEvents).toBe(3);
    expect(report.leakageAudit).toMatchObject({ totalInputSnapshots: preMatch.length + 3,
      preKickoffSnapshotsUsed: preMatch.length, atOrAfterKickoffSnapshotsExcluded: 3,
      matchesContainingAtOrAfterKickoffSnapshots: 1, unsafeSnapshotsUsed: 0 });
    expect(report.futureLeakageViolations).toBe(report.leakageAudit.unsafeSnapshotsUsed);
  });
});
