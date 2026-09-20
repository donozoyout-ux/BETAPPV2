import { describe, expect, it } from 'vitest';
import { historicalOddsBackfillAudit } from '../../src/historical-odds/audit.js';
import { classifyHistoricalOdds } from '../../src/historical-odds/classification.js';

describe('historical odds qualification safeguards', () => {
  it('does not convert un-timestamped archived fields into opening, closing, or route evidence', () => {
    const result = classifyHistoricalOdds({ fixtureCount: 12, oddsRowCount: 30, markets: ['1x2', 'HDP', 'OU', 'CR'],
      sourceTimestampFields: [], openingExplicitlyIdentified: false, closingExplicitlyPreKickoff: false });
    expect(result).toEqual({
      historicalFixtures: 'SUPPORTED', historicalSingleOddsState: 'PARTIAL', genuineOpeningOdds: 'UNAVAILABLE',
      genuinePrematchClosingOdds: 'UNAVAILABLE', fullHistoricalMovement: 'UNAVAILABLE', genuineHistoricalTimestamps: 'UNAVAILABLE',
      markets: { '1X2': 'SUPPORTED', ASIAN_HANDICAP: 'SUPPORTED', TOTAL_GOALS: 'SUPPORTED', CORNERS: 'SUPPORTED' },
    });
  });

  it('requires explicit source semantics in addition to a genuine timestamp', () => {
    const result = classifyHistoricalOdds({ fixtureCount: 1, oddsRowCount: 3, markets: ['1x2'],
      sourceTimestampFields: ['observedAt'], openingExplicitlyIdentified: false, closingExplicitlyPreKickoff: false });
    expect(result.historicalSingleOddsState).toBe('SUPPORTED');
    expect(result.genuineHistoricalTimestamps).toBe('SUPPORTED');
    expect(result.genuineOpeningOdds).toBe('UNAVAILABLE');
    expect(result.genuinePrematchClosingOdds).toBe('UNAVAILABLE');
    expect(result.fullHistoricalMovement).toBe('NOT_VERIFIED');
  });

  it('publishes zero import counts instead of pretending qualification data was imported', () => {
    expect(historicalOddsBackfillAudit()).toMatchObject({ source: 'nowgoal', status: 'NOT_IMPLEMENTED',
      matchesAttempted: 0, matchesWithGenuineOpening: 0, matchesWithFullMovementHistory: 0, markets: [] });
  });
});
