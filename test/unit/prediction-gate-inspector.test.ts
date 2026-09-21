import { describe, expect, it } from 'vitest';
import { predictionConfig } from '../../src/predictions/config.js';
import { inspectPredictionGates, translatePredictionGateReason } from '../../src/predictions/gate-inspector.js';
import { officialCandidateBlockers } from '../../src/predictions/prediction-gates.js';
import type { PredictionCandidate } from '../../src/predictions/types.js';

const kickoffAt = new Date('2026-09-21T18:00:00Z');
const insideWindow = new Date('2026-09-21T17:00:00Z');

function candidate(overrides: Partial<PredictionCandidate> = {}): PredictionCandidate {
  return { marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection: 'OVER', referenceOdds: 1.88,
    openingOdds: 2.05, currentOdds: 1.88, currentFairProbability: 0.55, probabilityDeltaPp: 3,
    predictionScore: 75, scoreComponents: { marketProbability: 12, oddsSignal: 15, historicalEvidence: 14,
      historicalSampleReliability: 8, bookmakerAgreement: 9, dataQuality: 9, modelConfidence: 8 },
    bookmakerCount: 7, agreementRatio: 0.72, dataQualityScore: 82, dataQualityGrade: 'GOOD',
    confidenceScore: 76, confidenceGrade: 'GOOD', movementClass: 'SUPPORT', analysisEligible: true,
    snapshotCount: 42, completeStateBookmakerCount: 7, minimumCompleteStateCount: 2,
    historical: { exampleIds: [], sampleSize: 35, settledSampleSize: 35, wins: 20, losses: 15, pushes: 0,
      halfWins: 0, halfLosses: 0, historicalHitRate: 0.57, wilsonLower95: 0.41, wilsonUpper95: 0.72,
      averageSimilarity: 0.84, scope: 'SAME_COMPETITION', historicalFrequencyGapPp: 2, status: 'SUFFICIENT' },
    cornerModelProbability: null, marketFairProbability: 0.55, modelMarketGapPp: null, cornerQuality: null,
    cornerConfirmation: 'UNAVAILABLE', reasons: [], warnings: [], ...overrides };
}

function inspect(value: PredictionCandidate | null, decision: 'PREDICT' | 'SKIP' = 'SKIP', extra: Record<string, unknown> = {}) {
  return inspectPredictionGates({ decision, kickoffAt, now: insideWindow, selectedCandidate: decision === 'PREDICT' ? value : null,
    candidates: value ? [value] : [], skipReasons: [], metadata: {}, ...extra });
}

const byKey = (result: ReturnType<typeof inspectPredictionGates>, key: string) =>
  result.gates.find((item) => item.key === key)!;

describe('Prediction Gate Inspector V1', () => {
  it('uses production historical, score and bookmaker thresholds from PredictionConfig', () => {
    const result = inspect(candidate({ predictionScore: 63, historical: {
      ...candidate().historical, sampleSize: 15, settledSampleSize: 15, status: 'INSUFFICIENT_SAMPLE',
    } }));
    expect(byKey(result, 'HISTORICAL_SAMPLE')).toMatchObject({ current: 15, required: 30, passed: false });
    expect(byKey(result, 'PREDICTION_SCORE')).toMatchObject({ current: 63, required: 70, passed: false });
    expect(byKey(result, 'BOOKMAKERS')).toMatchObject({ current: 7, required: 3, passed: true });
    expect(result.thresholds.minimumHistoricalSample).toBe(predictionConfig.minimumHistoricalSample);
    expect(result.thresholds.minimumPredictionScore).toBe(predictionConfig.minimumPredictionScore);
  });

  it('fails incomplete states and reports WAITING instead of weakening the official rule', () => {
    const result = inspect(candidate({ analysisEligible: false, completeStateBookmakerCount: 1,
      minimumCompleteStateCount: 1 }));
    expect(byKey(result, 'COMPLETE_STATES').passed).toBe(false);
    expect(result.overallStatus).toBe('WAITING');
  });

  it('fails NEUTRAL movement and classifies a meaningful candidate as REVIEW', () => {
    const result = inspect(candidate({ movementClass: 'NEUTRAL' }));
    expect(byKey(result, 'MOVEMENT')).toMatchObject({ current: 'NEUTRAL', passed: false });
    expect(result.overallStatus).toBe('REVIEW');
  });

  it('keeps a passing PREVIEW PREDICT in WAITING until it is persisted as an official lock', () => {
    const result = inspect(candidate(), 'PREDICT', { state: 'PREVIEW' });
    expect(result.overallStatus).toBe('WAITING');
    expect(result.summary).toBe('Resmi tahmin koşulları geçti ancak tahmin henüz kilitlenmedi.');
  });

  it('returns OFFICIAL only for a LOCKED_PREDICTION with every gate passed', () => {
    const result = inspect(candidate(), 'PREDICT', { state: 'LOCKED_PREDICTION' });
    expect(result.overallStatus).toBe('OFFICIAL');
    expect(result.gates.every((item) => item.passed)).toBe(true);
    expect(result.executionAuthority).toBe(false);
    expect(result.aiPredictionAuthority).toBe(false);
  });

  it('uses the same complete-state policy as the official engine blocker', () => {
    const value = candidate({ bookmakerCount: 7, completeStateBookmakerCount: 1,
      minimumCompleteStateCount: 2, analysisEligible: true });
    const result = inspect(value);
    expect(officialCandidateBlockers(value)).toContain('INSUFFICIENT_COMPLETE_STATES');
    expect(byKey(result, 'COMPLETE_STATES')).toMatchObject({ passed: false });
  });

  it('distinguishes ready odds analysis from a missing Prediction V1 run', () => {
    const result = inspectPredictionGates({ decision: 'SKIP', state: 'NOT_GENERATED', kickoffAt, now: insideWindow,
      oddsAnalysisExists: true, predictionRunExists: false, skipReasons: [], metadata: {} });
    expect(byKey(result, 'ODDS_ANALYSIS').passed).toBe(true);
    expect(byKey(result, 'PREDICTION_RUN')).toMatchObject({ passed: false, reasonCode: 'PREDICTION_NOT_GENERATED' });
    expect(result.overallStatus).toBe('WAITING');
    expect(result.blockers).toContain('PREDICTION_NOT_GENERATED');
    expect(result.blockers).not.toContain('NO_ODDS_ANALYSIS');
  });

  it('reports NO_ODDS_ANALYSIS only when analysis and prediction run are both missing', () => {
    const result = inspectPredictionGates({ decision: 'SKIP', state: 'NOT_GENERATED', kickoffAt, now: insideWindow,
      oddsAnalysisExists: false, predictionRunExists: false, skipReasons: [], metadata: {} });
    expect(byKey(result, 'ODDS_ANALYSIS')).toMatchObject({ passed: false, reasonCode: 'NO_ODDS_ANALYSIS' });
    expect(result.overallStatus).toBe('WAITING');
    expect(result.blockers).toContain('NO_ODDS_ANALYSIS');
    expect(result.blockers).not.toContain('PREDICTION_NOT_GENERATED');
  });

  it('rejects unsupported markets and active Self-Audit guards with Turkish reasons', () => {
    const unsupported = inspect(candidate({ marketType: 'PLAYER_PROPS' }));
    expect(unsupported.overallStatus).toBe('REJECTED');
    expect(unsupported.blockers).toContain('UNSUPPORTED_MARKET');
    const paused = inspect(candidate(), 'SKIP', { skipReasons: ['SELF_AUDIT_PAUSED'],
      metadata: { selfAuditGuardActive: true } });
    expect(paused.overallStatus).toBe('REJECTED');
    expect(byKey(paused, 'SELF_AUDIT_GLOBAL').reason).toContain('güvenlik freni');
    expect(translatePredictionGateReason('SELF_AUDIT_SEGMENT_PAUSED')).toContain('lig veya market');
  });

  it('uses an injected config as the only threshold source', () => {
    const custom = { ...predictionConfig, minimumHistoricalSample: 44, minimumPredictionScore: 79,
      minimumBookmakerCount: 6, minimumCompleteStateCount: 3 };
    const result = inspectPredictionGates({ decision: 'SKIP', kickoffAt, now: insideWindow,
      candidates: [candidate()], skipReasons: [], metadata: {} }, custom);
    expect(byKey(result, 'HISTORICAL_SAMPLE').required).toBe(44);
    expect(byKey(result, 'PREDICTION_SCORE').required).toBe(79);
    expect(byKey(result, 'BOOKMAKERS').required).toBe(6);
    expect((byKey(result, 'COMPLETE_STATES').required as { states: number }).states).toBe(3);
  });

  it('does not throw on legacy or malformed stored candidate JSON', () => {
    const legacy = {
      marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection: 'OVER',
      referenceOdds: 1.88, openingOdds: 2.05, currentOdds: 1.88,
      predictionScore: 76, bookmakerCount: 4, analysisEligible: true,
    } as unknown as PredictionCandidate;
    const result = inspectPredictionGates({ decision: 'PREDICT', state: 'PREVIEW', kickoffAt, now: insideWindow,
      candidates: [legacy, { predictionScore: 99 }], skipReasons: [], metadata: {},
      oddsAnalysisExists: true, predictionRunExists: true });
    expect(result.overallStatus).not.toBe('OFFICIAL');
    expect(byKey(result, 'HISTORICAL_SAMPLE')).toMatchObject({ current: 0, passed: false });
    expect(result.blockers).toContain('INSUFFICIENT_HISTORICAL_SAMPLE');
  });

  it('returns WAITING while the official window has not opened', () => {
    const result = inspectPredictionGates({ decision: 'PREDICT', kickoffAt,
      now: new Date('2026-09-21T14:00:00Z'), selectedCandidate: candidate(), candidates: [candidate()],
      skipReasons: [], metadata: {} });
    expect(result.overallStatus).toBe('WAITING');
    expect(byKey(result, 'OFFICIAL_WINDOW').reasonCode).toBe('OFFICIAL_WINDOW_NOT_OPEN');
  });
});
