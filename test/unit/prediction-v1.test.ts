import { describe, expect, it } from 'vitest';
import { predictionConfig, predictionConfigHash } from '../../src/predictions/config.js';
import { evaluatePrediction, lockWindowState } from '../../src/predictions/engine.js';
import { buildPerformance, runPredictionBacktest, runPredictionBacktestFromSnapshots } from '../../src/predictions/history.js';
import { scorePrediction } from '../../src/predictions/scoring.js';
import { findHistoricalEvidence, sameMarketIdentity, wilsonInterval } from '../../src/predictions/similarity.js';
import { referencePaperReturn, settleAsianHandicap, settlePrediction, settleTotal } from '../../src/predictions/settlement.js';
import type { AnalysisItem } from '../../src/odds-analysis/types.js';
import type { HistoricalExample, PredictionTarget } from '../../src/predictions/types.js';

const kickoff = new Date('2026-09-20T18:00:00Z');
const looseConfig = { ...predictionConfig, minimumHistoricalSample: 1, targetHistoricalSample: 1,
  minimumPredictionScore: 0, minimumDataQualityScore: 0, minimumConfidenceScore: 0, minimumBookmakerCount: 1,
  minimumCompleteStateCount: 1 };

function item(overrides: Partial<AnalysisItem> = {}): AnalysisItem {
  return { marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection: 'OVER', openingOdds: 2,
    currentOdds: 1.8, highestOdds: 2, lowestOdds: 1.8, snapshotCount: 6, openingFairProbability: 0.45,
    currentFairProbability: 0.56, probabilityDeltaPp: 11, rawOddsMovementPercent: -10, bookmakerCount: 3,
    completeStateBookmakerCount: 3, minimumCompleteStateCount: 2, agreeingBookmakerCount: 3,
    disagreeingBookmakerCount: 0, movementAgreementRatio: 1, probabilityDispersion: 0.2, oddsDispersion: 0.1,
    movementClass: 'SUPPORT', score: 80, scoreComponents: { movement: 30, agreement: 20, coverage: 20, freshness: 15, stability: 15 },
    dataQuality: { score: 90, grade: 'GOOD', analysisEligible: true, warnings: [] },
    modelConfidence: { score: 85, grade: 'GOOD' }, analysisEligible: true, reasons: [], warnings: [],
    modelMarketGapPp: null, ...overrides };
}

function example(index: number, overrides: Partial<HistoricalExample> = {}): HistoricalExample {
  return { id: `h${index}`, matchId: `historic-${index}`, competitionId: 'league-a',
    kickoffAt: new Date(kickoff.getTime() - (index + 1) * 86_400_000), oddsInputHash: `odds-${index}`,
    featureCutoffAt: new Date(kickoff.getTime() - (index + 1) * 86_400_000 - 90 * 60_000), featureLeadMinutes: 90,
    analysisEligible: true, dataQualityGrade: 'GOOD', confidenceGrade: 'GOOD', completeStateBookmakerCount: 3,
    minimumCompleteStateCount: 2,
    marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection: 'OVER', openingOdds: 2,
    currentOdds: 1.8, openingFairProbability: 0.45, currentFairProbability: 0.56, probabilityDeltaPp: 11,
    bookmakerCount: 3, movementAgreementRatio: 1, oddsAnalysisScore: 80, dataQualityScore: 90, confidenceScore: 85,
    movementClass: 'SUPPORT', settlementResult: 'WIN', homeScore: 2, awayScore: 1, homeCorners: 5, awayCorners: 5, ...overrides };
}

describe('PREDICTION_V1 similarity and scoring', () => {
  it('keeps market identity and lines isolated', () => {
    expect(sameMarketIdentity(item(), example(1))).toBe(true);
    expect(sameMarketIdentity(item({ line: 3.5 }), example(1))).toBe(false);
    expect(sameMarketIdentity(item({ marketType: 'TOTAL_CORNERS' }), example(1))).toBe(false);
  });

  it('prefers same competition and transparently falls back globally', () => {
    const local = findHistoricalEvidence(item(), 'league-a', kickoff, [example(1)], looseConfig);
    expect(local.scope).toBe('SAME_COMPETITION');
    const global = findHistoricalEvidence(item(), 'league-b', kickoff, [example(1)], looseConfig);
    expect(global.scope).toBe('GLOBAL_SUPPORTED_COMPETITIONS');
  });

  it('excludes future historical matches and reports insufficient samples', () => {
    const future = example(2, { kickoffAt: new Date(kickoff.getTime() + 1) });
    const evidence = findHistoricalEvidence(item(), 'league-a', kickoff, [example(1), future], predictionConfig);
    expect(evidence.exampleIds).toEqual(['h1']);
    expect(evidence.status).toBe('INSUFFICIENT_SAMPLE');
  });

  it('excludes otherwise similar ineligible historical examples from N', () => {
    const evidence = findHistoricalEvidence(item(), 'league-a', kickoff,
      [example(1), example(2, { analysisEligible: false })], looseConfig);
    expect(evidence.sampleSize).toBe(1);
    expect(evidence.exampleIds).toEqual(['h1']);
  });

  it('uses a deterministic Wilson interval and deterministic config hash', () => {
    expect(wilsonInterval(6, 10)).toEqual(wilsonInterval(6, 10));
    expect(wilsonInterval(0, 0)).toEqual([null, null]);
    expect(predictionConfigHash()).toBe(predictionConfigHash({ ...predictionConfig }));
  });

  it('makes score components sum to the published deterministic score', () => {
    const evidence = findHistoricalEvidence(item(), 'league-a', kickoff, [example(1)], looseConfig);
    const scored = scorePrediction(item(), evidence, looseConfig);
    expect(Object.values(scored.components).reduce((sum, value) => sum + value, 0)).toBeCloseTo(scored.score);
  });

  it('selects one deterministic candidate or an explicit SKIP', () => {
    const target: PredictionTarget = { matchId: 'target', competitionId: 'league-a', kickoffAt: kickoff, oddsInputHash: 'input',
      oddsItems: [item({ selection: 'UNDER', probabilityDeltaPp: 5 }), item()] };
    const first = evaluatePrediction(target, [example(1), example(2)], kickoff, looseConfig);
    const second = evaluatePrediction({ ...target, oddsItems: [...target.oddsItems].reverse() }, [example(1), example(2)], kickoff, looseConfig);
    expect(first.decision).toBe('PREDICT');
    expect(first.selectedCandidate?.selection).toBe(second.selectedCandidate?.selection);
    const skipped = evaluatePrediction({ ...target, oddsItems: [] }, [], kickoff, looseConfig);
    expect(skipped).toMatchObject({ decision: 'SKIP', skipReasons: ['NO_ODDS_ANALYSIS'] });
  });

  it('does not select a candidate with too few complete-state bookmakers', () => {
    const strictCompleteness = { ...looseConfig, minimumBookmakerCount: 3, minimumCompleteStateCount: 2 };
    const target: PredictionTarget = { matchId: 'incomplete-target', competitionId: 'league-a', kickoffAt: kickoff,
      oddsInputHash: 'incomplete-input', oddsItems: [item({ bookmakerCount: 7, completeStateBookmakerCount: 1,
        minimumCompleteStateCount: 2, analysisEligible: true })] };
    const result = evaluatePrediction(target, [example(1)], kickoff, strictCompleteness);
    expect(result.decision).toBe('SKIP');
    expect(result.selectedCandidate).toBeNull();
    expect(result.skipReasons).toContain('INSUFFICIENT_COMPLETE_STATES');
  });

  it('exposes pre-kickoff lock eligibility and never permits a late lock', () => {
    expect(lockWindowState(kickoff, new Date('2026-09-20T17:00:00Z')).eligible).toBe(true);
    expect(lockWindowState(kickoff, new Date('2026-09-20T17:55:00Z')).missed).toBe(true);
    expect(lockWindowState(kickoff, new Date('2026-09-20T18:01:00Z')).missed).toBe(true);
  });
});

describe('PREDICTION_V1 settlement', () => {
  it('settles 1X2 and total integer, half, and quarter lines', () => {
    expect(settlePrediction({ marketType: '1X2', marketName: '1X2', line: null, selection: 'DRAW', matchStatus: 'finished', homeScore: 1, awayScore: 1 }).outcome).toBe('WIN');
    expect(settleTotal(2, 2, 'OVER')).toBe('PUSH');
    expect(settleTotal(3, 2.5, 'OVER')).toBe('WIN');
    expect(settleTotal(2, 2.25, 'OVER')).toBe('HALF_LOSS');
    expect(settleTotal(3, 2.75, 'UNDER')).toBe('HALF_LOSS');
  });

  it('uses Nowgoal home-side Asian handicap convention for both selections', () => {
    expect(settleAsianHandicap(2, 0, -2, 'HOME')).toBe('PUSH');
    expect(settleAsianHandicap(2, 0, -2, 'AWAY')).toBe('PUSH');
    expect(settleAsianHandicap(3, 0, -2, 'HOME')).toBe('WIN');
    expect(settleAsianHandicap(3, 0, -2, 'AWAY')).toBe('LOSS');
    expect(settleAsianHandicap(1, 0, -2, 'HOME')).toBe('LOSS');
    expect(settleAsianHandicap(1, 0, -2, 'AWAY')).toBe('WIN');
    expect(settleAsianHandicap(0, 0, -0.25, 'HOME')).toBe('HALF_LOSS');
  });

  it('settles corners only from normalized data and preserves pending/void states', () => {
    expect(settlePrediction({ marketType: 'TOTAL_CORNERS', marketName: 'Corners', line: 9.5, selection: 'OVER',
      matchStatus: 'finished', homeScore: 1, awayScore: 0 }).reason).toBe('NO_SETTLEMENT_DATA');
    expect(settlePrediction({ marketType: 'TOTAL_CORNERS', marketName: 'Corners', line: 9.5, selection: 'OVER',
      matchStatus: 'finished', homeScore: 1, awayScore: 0, homeCorners: 6, awayCorners: 5 }).outcome).toBe('WIN');
    expect(settlePrediction({ marketType: 'TOTAL_GOALS', marketName: 'Goals', line: 2.5, selection: 'OVER',
      matchStatus: 'cancelled', homeScore: null, awayScore: null }).outcome).toBe('VOID');
    expect(settlePrediction({ marketType: 'TOTAL_GOALS', marketName: 'Goals', line: 2.5, selection: 'OVER',
      matchStatus: 'postponed', homeScore: null, awayScore: null }).outcome).toBeNull();
  });

  it('uses reference paper returns, never real execution returns', () => {
    expect(referencePaperReturn('WIN', 1.9)).toBeCloseTo(0.9);
    expect(referencePaperReturn('HALF_WIN', 1.9)).toBeCloseTo(0.45);
    expect(referencePaperReturn('HALF_LOSS', 1.9)).toBe(-0.5);
  });
});

describe('PREDICTION_V1 performance and chronological backtest', () => {
  it('counts only official records and includes N for every rate', () => {
    const report = buildPerformance([{ decision: 'PREDICT', outcome: 'WIN', marketType: 'TOTAL_GOALS', league: 'A',
      predictionScore: 82, confidenceScore: 80, dataQualityGrade: 'GOOD', bookmakerCount: 3, historicalSampleSize: 40,
      historicalHitRate: 0.6, movementClass: 'SUPPORT', referencePaperReturn: 0.9 },
    { decision: 'SKIP', outcome: null, marketType: null, league: 'A', predictionScore: null, confidenceScore: null,
      dataQualityGrade: null, bookmakerCount: null, historicalSampleSize: 0, historicalHitRate: null, movementClass: null,
      referencePaperReturn: null }]);
    expect(report).toMatchObject({ totalOfficialDecisions: 2, predictCount: 1, skipCount: 1, settled: 1, win: 1 });
    expect(report.byPredictionScore['80-84']).toMatchObject({ sampleSize: 1, positiveRate: 1 });
  });

  it('audits actual future-leakage evidence during chronological replay', () => {
    const first = new Date('2026-09-10T18:00:00Z');
    const targets: PredictionTarget[] = [{ matchId: 'historic-1', competitionId: 'league-a', kickoffAt: first,
      oddsInputHash: 'a', oddsItems: [item()] }, { matchId: 'historic-2', competitionId: 'league-a', kickoffAt: kickoff,
      oddsInputHash: 'b', oddsItems: [item()] }];
    const report = runPredictionBacktest(targets, [example(1, { kickoffAt: first }), example(2, { kickoffAt: kickoff }),
      example(3, { kickoffAt: new Date(kickoff.getTime() + 86_400_000), settlementResult: 'LOSS' })], looseConfig);
    expect(report.futureLeakageViolations).toBe(0);
    expect(report.matchesEvaluated).toBe(2);
  });

  it('reconstructs target odds at the simulated lock and ignores later prices', () => {
    const target = { matchId: 'historic-2', competitionId: 'league-a', kickoffAt: kickoff, snapshots: [
      { matchId: 'historic-2', provider: 'p1', marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME', oddsDecimal: 2.1, capturedAt: new Date('2026-09-20T16:20:00Z') },
      { matchId: 'historic-2', provider: 'p1', marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'DRAW', oddsDecimal: 3.3, capturedAt: new Date('2026-09-20T16:20:00Z') },
      { matchId: 'historic-2', provider: 'p1', marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'AWAY', oddsDecimal: 3.6, capturedAt: new Date('2026-09-20T16:20:00Z') },
      { matchId: 'historic-2', provider: 'p1', marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME', oddsDecimal: 1.01, capturedAt: new Date('2026-09-20T17:40:00Z') },
      { matchId: 'historic-2', provider: 'p1', marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'DRAW', oddsDecimal: 50, capturedAt: new Date('2026-09-20T18:01:00Z') },
    ] };
    const report = runPredictionBacktestFromSnapshots([target], [example(1), example(2, { kickoffAt: kickoff })], looseConfig);
    expect(report.targetsWithoutOddsAtLock).toBe(1);
    expect(report.afterSimulatedLockSnapshotsExcluded).toBe(1);
    expect(report.postKickoffSnapshotsExcluded).toBe(1);
    expect(report).toMatchObject({ postKickoffLeakageViolations: 0, decisionTimeLeakageViolations: 0 });
  });
});
