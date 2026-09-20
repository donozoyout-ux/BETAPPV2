import { describe, expect, it } from 'vitest';
import { classifyPredictionDisplay, formatPredictionReason, movementExplanation,
  predictionGateGaps } from '../../src/predictions/presentation.js';
import type { PredictionCandidate } from '../../src/predictions/types.js';

function candidate(overrides: Partial<PredictionCandidate> = {}): PredictionCandidate {
  return { marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME', referenceOdds: 1.9,
    openingOdds: 2.05, currentOdds: 1.9, currentFairProbability: 0.52, probabilityDeltaPp: 0.8,
    predictionScore: 58, scoreComponents: { marketProbability: 10, oddsSignal: 10, historicalEvidence: 10,
      historicalSampleReliability: 5, bookmakerAgreement: 8, dataQuality: 8, modelConfidence: 7 },
    bookmakerCount: 2, agreementRatio: 0.71, dataQualityScore: 65, dataQualityGrade: 'LIMITED',
    confidenceScore: 60, confidenceGrade: 'LIMITED', movementClass: 'NEUTRAL', analysisEligible: false,
    snapshotCount: 6, completeStateBookmakerCount: 1, minimumCompleteStateCount: 1,
    historical: { exampleIds: ['a','b','c','d','e'], sampleSize: 5, settledSampleSize: 5, wins: 3, losses: 2,
      pushes: 0, halfWins: 0, halfLosses: 0, historicalHitRate: 0.6, wilsonLower95: 0.23, wilsonUpper95: 0.88,
      averageSimilarity: 0.82, scope: 'SAME_COMPETITION', historicalFrequencyGapPp: 8, status: 'INSUFFICIENT_SAMPLE' },
    cornerModelProbability: null, marketFairProbability: 0.52, modelMarketGapPp: null, cornerQuality: null,
    cornerConfirmation: 'UNAVAILABLE', reasons: [], warnings: [], ...overrides };
}

describe('prediction presentation policy', () => {
  it('translates public reasons while retaining deterministic raw classification input', () => {
    expect(formatPredictionReason('ODDS_NOT_ELIGIBLE')).toBe('Oran verisi henüz yeterli değil');
    expect(formatPredictionReason('MOVEMENT_NOT_SUPPORTED')).toContain('yeterli oran hareketi');
  });

  it('classifies evidence as REVIEW without changing the official decision', () => {
    const row = { decision: 'SKIP', candidates: [candidate()], skip_reasons: ['MOVEMENT_NOT_SUPPORTED'] };
    expect(classifyPredictionDisplay(row)).toBe('REVIEW');
    expect(row.decision).toBe('SKIP');
    expect(predictionGateGaps(candidate()).map((gap) => gap.key)).toContain('historical');
  });

  it('rejects unsafe, invalid, or hard-paused candidates', () => {
    expect(classifyPredictionDisplay({ decision: 'SKIP', candidates: [candidate()],
      skip_reasons: ['SELF_AUDIT_PAUSED'] })).toBe('REJECTED');
    expect(classifyPredictionDisplay({ decision: 'SKIP', candidates: [candidate({ currentOdds: 1 })],
      skip_reasons: [] })).toBe('REJECTED');
  });

  it('explains movement magnitude separately from bookmaker agreement', () => {
    expect(movementExplanation(candidate())).toContain('hareket büyüklüğü');
    expect(movementExplanation(candidate({ agreementRatio: 0.4 }))).toContain('tutarlı değil');
  });
});
