import { describe, expect, it } from 'vitest';
import { evaluateSelfAudit, selfAuditConfigHash, type SelfAuditRecord } from '../../src/predictions/self-audit.js';
import type { SettlementOutcome } from '../../src/predictions/types.js';

const base = new Date('2026-09-19T12:00:00Z');

function records(outcomes: SettlementOutcome[], winReturn = 0.9): SelfAuditRecord[] {
  return outcomes.map((outcome, index) => ({
    settlementId: `s-${index}`,
    settledAt: new Date(base.getTime() - index * 60_000),
    outcome,
    referencePaperReturn: outcome === 'WIN' ? winReturn
      : outcome === 'HALF_WIN' ? winReturn / 2
      : outcome === 'LOSS' ? -1
      : outcome === 'HALF_LOSS' ? -0.5 : 0,
    historicalHitRate: ['PUSH', 'VOID'].includes(outcome) ? null : 0.65,
  }));
}

describe('Prediction SELF_AUDIT_V1', () => {
  it('stays insufficient until the minimum settled binary sample is reached', () => {
    const report = evaluateSelfAudit(records(Array(10).fill('WIN') as SettlementOutcome[]), base);
    expect(report.status).toBe('INSUFFICIENT_DATA');
    expect(report.binarySampleSize).toBe(10);
    expect(report.reasons).toContain('SELF_AUDIT_MIN_SAMPLE_NOT_REACHED');
  });

  it('reports HEALTHY for a stable positive sample', () => {
    const outcomes = [...Array(20).fill('WIN'), ...Array(10).fill('LOSS')] as SettlementOutcome[];
    const report = evaluateSelfAudit(records(outcomes, 0.9), base);
    expect(report.status).toBe('HEALTHY');
    expect(report.recentPositiveRate).toBeCloseTo(20 / 30);
    expect(report.recentReferencePaperRoi).toBeGreaterThan(0);
  });

  it('reports WATCH before PAUSED for moderate degradation', () => {
    const outcomes = [...Array(14).fill('WIN'), ...Array(16).fill('LOSS')] as SettlementOutcome[];
    const report = evaluateSelfAudit(records(outcomes, 0.9), base);
    expect(report.status).toBe('WATCH');
    expect(report.reasons).toContain('SELF_AUDIT_RECENT_PERFORMANCE_WATCH');
  });

  it('pauses when both recent positive rate and reference paper ROI are severely weak', () => {
    const outcomes = [...Array(10).fill('WIN'), ...Array(20).fill('LOSS')] as SettlementOutcome[];
    const report = evaluateSelfAudit(records(outcomes, 0.9), base);
    expect(report.status).toBe('PAUSED');
    expect(report.reasons).toContain('SELF_AUDIT_RECENT_PERFORMANCE_PAUSE');
  });

  it('pauses on an eight-result loss streak even if the older window was stronger', () => {
    const outcomes = [...Array(8).fill('LOSS'), ...Array(22).fill('WIN')] as SettlementOutcome[];
    const report = evaluateSelfAudit(records(outcomes, 1.2), base);
    expect(report.lossStreak).toBe(8);
    expect(report.status).toBe('PAUSED');
    expect(report.reasons).toContain('SELF_AUDIT_LOSS_STREAK_PAUSE');
  });

  it('excludes PUSH and VOID from binary hit rate and keeps hashing deterministic', () => {
    const outcomes = [...Array(15).fill('WIN'), ...Array(15).fill('LOSS'), 'PUSH', 'VOID'] as SettlementOutcome[];
    const input = records(outcomes);
    const first = evaluateSelfAudit(input, base);
    const second = evaluateSelfAudit([...input].reverse(), new Date(base.getTime() + 1000));
    expect(first.binarySampleSize).toBe(30);
    expect(first.inputHash).toBe(second.inputHash);
    expect(selfAuditConfigHash()).toMatch(/^[a-f0-9]{64}$/);
  });
});
