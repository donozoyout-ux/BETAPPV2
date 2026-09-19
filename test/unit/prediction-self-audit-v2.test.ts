import { describe, expect, it } from 'vitest';
import { evaluateSegmentSelfAudits, leagueMarketSegmentKey, marketSegmentKey, type SegmentSelfAuditRecord } from '../../src/predictions/self-audit-v2.js';
import type { SettlementOutcome } from '../../src/predictions/types.js';

const base = new Date('2026-09-19T12:00:00Z');

function rows(
  competitionId: string,
  competitionName: string,
  marketType: string,
  outcomes: SettlementOutcome[],
  winReturn = 0.9,
): SegmentSelfAuditRecord[] {
  return outcomes.map((outcome, index) => ({
    settlementId: `${competitionId}-${marketType}-${index}`,
    settledAt: new Date(base.getTime() - index * 60_000),
    outcome,
    referencePaperReturn: outcome === 'WIN' ? winReturn
      : outcome === 'HALF_WIN' ? winReturn / 2
      : outcome === 'LOSS' ? -1
      : outcome === 'HALF_LOSS' ? -0.5 : 0,
    historicalHitRate: ['PUSH', 'VOID'].includes(outcome) ? null : 0.60,
    competitionId,
    competitionName,
    marketType,
  }));
}

describe('Prediction SELF_AUDIT_V2 segments', () => {
  it('evaluates markets independently so one bad market does not pause another', () => {
    const records = [
      ...rows('league-a', 'League A', 'TOTAL_GOALS', [...Array(5).fill('WIN'), ...Array(7).fill('LOSS')] as SettlementOutcome[]),
      ...rows('league-a', 'League A', 'MATCH_RESULT', [...Array(9).fill('WIN'), ...Array(3).fill('LOSS')] as SettlementOutcome[], 1.1),
    ];
    const reports = evaluateSegmentSelfAudits(records, base);
    const totals = reports.find((item) => item.segmentKey === marketSegmentKey('TOTAL_GOALS'));
    const result = reports.find((item) => item.segmentKey === marketSegmentKey('MATCH_RESULT'));
    expect(totals?.status).toBe('WATCH');
    expect(result?.status).toBe('HEALTHY');
  });

  it('pauses only a severely degraded league-market segment', () => {
    const records = [
      ...rows('league-a', 'League A', 'TOTAL_GOALS', [...Array(3).fill('WIN'), ...Array(9).fill('LOSS')] as SettlementOutcome[]),
      ...rows('league-b', 'League B', 'TOTAL_GOALS', [...Array(9).fill('WIN'), ...Array(3).fill('LOSS')] as SettlementOutcome[], 1.1),
    ];
    const reports = evaluateSegmentSelfAudits(records, base);
    const bad = reports.find((item) => item.segmentKey === leagueMarketSegmentKey('league-a', 'TOTAL_GOALS'));
    const good = reports.find((item) => item.segmentKey === leagueMarketSegmentKey('league-b', 'TOTAL_GOALS'));
    expect(bad?.status).toBe('PAUSED');
    expect(bad?.pauseUntil?.getTime()).toBeGreaterThan(base.getTime());
    expect(good?.status).toBe('HEALTHY');
  });

  it('keeps thin segments in INSUFFICIENT_DATA instead of making aggressive decisions', () => {
    const reports = evaluateSegmentSelfAudits(
      rows('league-thin', 'Thin League', 'ASIAN_HANDICAP', Array(5).fill('LOSS') as SettlementOutcome[]), base);
    expect(reports.every((item) => item.status === 'INSUFFICIENT_DATA')).toBe(true);
  });

  it('produces MARKET, LEAGUE and LEAGUE_MARKET scopes from the same immutable settlements', () => {
    const reports = evaluateSegmentSelfAudits(
      rows('league-a', 'League A', 'MATCH_RESULT', Array(12).fill('WIN') as SettlementOutcome[]), base);
    expect(new Set(reports.map((item) => item.scopeType))).toEqual(new Set(['MARKET', 'LEAGUE', 'LEAGUE_MARKET']));
    expect(reports).toHaveLength(3);
  });
});
