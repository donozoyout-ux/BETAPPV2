import { describe, expect, it } from 'vitest';
import { evaluateRootCauses, type RootCauseRecord } from '../../src/predictions/self-audit-v3.js';
import type { SettlementOutcome } from '../../src/predictions/types.js';

const base = new Date('2026-09-19T12:00:00Z');

function record(index: number, outcome: SettlementOutcome, overrides: Partial<RootCauseRecord> = {}): RootCauseRecord {
  return {
    settlementId: `s-${index}`,
    settledAt: new Date(base.getTime() - index * 60_000),
    outcome,
    referencePaperReturn: outcome === 'WIN' ? 0.9 : outcome === 'HALF_WIN' ? 0.45
      : outcome === 'LOSS' ? -1 : outcome === 'HALF_LOSS' ? -0.5 : 0,
    historicalHitRate: ['PUSH', 'VOID'].includes(outcome) ? null : 0.62,
    predictionScore: 86,
    bookmakerCount: 5,
    historicalSampleSize: 100,
    dataQualityGrade: 'GOOD',
    confidenceGrade: 'GOOD',
    movementClass: 'SUPPORT',
    agreementRatio: 0.9,
    ...overrides,
  };
}

describe('Prediction SELF_AUDIT_V3 root cause diagnostics', () => {
  it('identifies an underperforming prediction-score bucket without marking healthy buckets high risk', () => {
    const records: RootCauseRecord[] = [];
    for (let i = 0; i < 12; i += 1) {
      records.push(record(i, i < 2 ? 'WIN' : 'LOSS', { predictionScore: 72, bookmakerCount: 3, agreementRatio: 0.68 }));
    }
    for (let i = 12; i < 60; i += 1) {
      records.push(record(i, i < 48 ? 'WIN' : 'LOSS', { predictionScore: 87, bookmakerCount: 6, agreementRatio: 0.94 }));
    }

    const reports = evaluateRootCauses(records, base);
    const weak = reports.find((item) => item.dimension === 'PREDICTION_SCORE' && item.bucketKey === '70-74');
    const strong = reports.find((item) => item.dimension === 'PREDICTION_SCORE' && item.bucketKey === '85-89');

    expect(weak).toMatchObject({ status: 'HIGH_RISK', binarySampleSize: 12 });
    expect(weak!.positiveRateGap).toBeLessThan(-0.2);
    expect(weak!.referencePaperRoiGap).toBeLessThan(-0.2);
    expect(weak!.rootCauseScore).toBeGreaterThan(0);
    expect(strong?.status).toBe('HEALTHY');
  });

  it('does not call a thin bucket risky when its sample is below the evidence threshold', () => {
    const records: RootCauseRecord[] = [];
    for (let i = 0; i < 5; i += 1) records.push(record(i, 'LOSS', { bookmakerCount: 3 }));
    for (let i = 5; i < 40; i += 1) records.push(record(i, 'WIN', { bookmakerCount: 6 }));
    const reports = evaluateRootCauses(records, base);
    const thin = reports.find((item) => item.dimension === 'BOOKMAKER_COUNT' && item.bucketKey === '3');
    expect(thin?.status).toBe('INSUFFICIENT_DATA');
    expect(thin?.reasons).toContain('ROOT_CAUSE_BUCKET_SAMPLE_INSUFFICIENT');
  });

  it('requires a baseline sample before making root-cause claims', () => {
    const records = Array.from({ length: 20 }, (_, i) => record(i, i < 4 ? 'WIN' : 'LOSS', { predictionScore: 72 }));
    const reports = evaluateRootCauses(records, base);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((item) => item.status === 'INSUFFICIENT_DATA')).toBe(true);
    expect(reports.some((item) => item.reasons.includes('ROOT_CAUSE_BASELINE_SAMPLE_INSUFFICIENT'))).toBe(true);
  });

  it('returns all seven diagnostic dimensions when the source fields are present', () => {
    const records = Array.from({ length: 40 }, (_, i) => record(i, i < 28 ? 'WIN' : 'LOSS'));
    const reports = evaluateRootCauses(records, base);
    expect(new Set(reports.map((item) => item.dimension))).toEqual(new Set([
      'PREDICTION_SCORE','BOOKMAKER_COUNT','HISTORICAL_SAMPLE','DATA_QUALITY_GRADE',
      'CONFIDENCE_GRADE','MOVEMENT_CLASS','AGREEMENT_RATIO',
    ]));
  });
});
