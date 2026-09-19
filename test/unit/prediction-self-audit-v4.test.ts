import { describe, expect, it } from 'vitest';
import { predictionConfig } from '../../src/predictions/config.js';
import { generateAdaptiveRuleProposals, type AdaptiveRuleProposal } from '../../src/predictions/self-audit-v4.js';
import type { RootCauseRecord } from '../../src/predictions/self-audit-v3.js';
import type { SettlementOutcome } from '../../src/predictions/types.js';

const base = new Date('2026-09-20T12:00:00Z');

function row(index: number, outcome: SettlementOutcome, overrides: Partial<RootCauseRecord> = {}): RootCauseRecord {
  return {
    settlementId: `s-${index}`,
    settledAt: new Date(base.getTime() - index * 60_000),
    outcome,
    referencePaperReturn: outcome === 'WIN' ? 0.9 : outcome === 'HALF_WIN' ? 0.45
      : outcome === 'LOSS' ? -1 : outcome === 'HALF_LOSS' ? -0.5 : 0,
    historicalHitRate: ['PUSH','VOID'].includes(outcome) ? null : 0.60,
    predictionScore: 87,
    bookmakerCount: 6,
    historicalSampleSize: 120,
    dataQualityGrade: 'GOOD',
    confidenceGrade: 'GOOD',
    movementClass: 'SUPPORT',
    agreementRatio: 0.94,
    ...overrides,
  };
}

function addGroup(
  out: RootCauseRecord[],
  start: number,
  wins: number,
  losses: number,
  overrides: Partial<RootCauseRecord>,
): number {
  let index = start;
  for (let i = 0; i < wins; i += 1) out.push(row(index++, 'WIN', overrides));
  for (let i = 0; i < losses; i += 1) out.push(row(index++, 'LOSS', overrides));
  return index;
}

function findCombination(proposals: AdaptiveRuleProposal[], left: string, right: string) {
  return proposals.find((proposal) => proposal.proposalType === 'COMBINATION_GUARD'
    && proposal.conditions.some((item) => item.bucketLabel === left)
    && proposal.conditions.some((item) => item.bucketLabel === right));
}

describe('Prediction SELF_AUDIT_V4 adaptive proposals', () => {
  it('finds a harmful interaction that is materially worse than both individual parents', () => {
    const records: RootCauseRecord[] = [];
    let index = 0;

    // Bad interaction: low score + minimum bookmaker coverage.
    index = addGroup(records, index, 1, 14, { predictionScore: 72, bookmakerCount: 3, agreementRatio: 0.68 });
    // Each individual parent gets healthier observations outside the interaction.
    index = addGroup(records, index, 9, 6, { predictionScore: 72, bookmakerCount: 6, agreementRatio: 0.94 });
    index = addGroup(records, index, 9, 6, { predictionScore: 87, bookmakerCount: 3, agreementRatio: 0.94 });
    addGroup(records, index, 40, 15, { predictionScore: 87, bookmakerCount: 6, agreementRatio: 0.94 });

    const proposals = generateAdaptiveRuleProposals(records, predictionConfig, base);
    const combo = findCombination(proposals, 'Prediction Score: 70-74', 'Bookmaker: 3');

    expect(combo).toBeDefined();
    expect(combo?.severity).toBe('HIGH_RISK');
    expect(combo?.binarySampleSize).toBe(15);
    expect(combo?.positiveRateGap).toBeLessThan(-0.4);
    expect(combo?.interactionPositiveRateGap).toBeLessThan(-0.2);
    expect(combo?.interactionReferencePaperRoiGap).toBeLessThan(-0.3);
    expect(combo?.suggestedChange).toMatchObject({
      kind: 'ADD_SKIP_RULE', operator: 'ALL', autoApply: false, executionAuthority: false,
    });
  });

  it('does not generate proposals before the global evidence floor is reached', () => {
    const records = Array.from({ length: 30 }, (_, index) =>
      row(index, index < 3 ? 'WIN' : 'LOSS', { predictionScore: 72, bookmakerCount: 3 }));
    expect(generateAdaptiveRuleProposals(records, predictionConfig, base)).toEqual([]);
  });

  it('does not invent a combination rule when the pair is not worse than its weaker parent', () => {
    const records: RootCauseRecord[] = [];
    let index = 0;
    index = addGroup(records, index, 4, 11, { predictionScore: 72, bookmakerCount: 3 });
    index = addGroup(records, index, 4, 11, { predictionScore: 72, bookmakerCount: 6 });
    index = addGroup(records, index, 4, 11, { predictionScore: 87, bookmakerCount: 3 });
    addGroup(records, index, 45, 10, { predictionScore: 87, bookmakerCount: 6 });

    const proposals = generateAdaptiveRuleProposals(records, predictionConfig, base);
    expect(findCombination(proposals, 'Prediction Score: 70-74', 'Bookmaker: 3')).toBeUndefined();
  });

  it('produces deterministic proposal keys and hashes for identical evidence', () => {
    const records: RootCauseRecord[] = [];
    let index = 0;
    index = addGroup(records, index, 1, 14, { predictionScore: 72, bookmakerCount: 3, agreementRatio: 0.68 });
    index = addGroup(records, index, 9, 6, { predictionScore: 72, bookmakerCount: 6, agreementRatio: 0.94 });
    index = addGroup(records, index, 9, 6, { predictionScore: 87, bookmakerCount: 3, agreementRatio: 0.94 });
    addGroup(records, index, 40, 15, { predictionScore: 87, bookmakerCount: 6, agreementRatio: 0.94 });

    const first = generateAdaptiveRuleProposals(records, predictionConfig, base);
    const second = generateAdaptiveRuleProposals([...records].reverse(), predictionConfig, new Date(base.getTime() + 1000));
    expect(first.map((item) => [item.proposalKey,item.inputHash]))
      .toEqual(second.map((item) => [item.proposalKey,item.inputHash]));
  });
});
