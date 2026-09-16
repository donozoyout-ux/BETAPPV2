import { describe, expect, it } from 'vitest';
import { resolveConsensus } from '../../src/consensus/engine.js';
import { oddsChanged } from '../../src/db/odds-repository.js';
import { kickoffConfidence, normalizeTeamAlias } from '../../src/matching/team-alias.js';
import { CircuitBreaker } from '../../src/providers/circuit-breaker.js';
import { normalizeIddaaMarkets } from '../../src/providers/iddaa-parser.js';

describe('provider qualification core', () => {
  it('normalizes known team aliases', () => {
    expect(normalizeTeamAlias('Man Utd FC')).toBe(normalizeTeamAlias('Manchester United'));
    expect(kickoffConfidence(new Date('2026-01-01T10:00Z'), new Date('2026-01-01T10:08Z'))).toBe('HIGH');
    expect(kickoffConfidence(new Date('2026-01-01T10:00Z'), new Date('2026-01-01T13:00Z'))).toBe('UNMATCHED');
  });

  it('resolves missing, single-source, verified and conflicting observations', () => {
    expect(resolveConsensus([]).status).toBe('MISSING');
    expect(resolveConsensus([{ provider: 'a', value: 11 }]).status).toBe('SINGLE_SOURCE');
    expect(resolveConsensus([{ provider: 'a', value: 11 }, { provider: 'b', value: 11 }])).toMatchObject({ status: 'VERIFIED', agreementCount: 2, confidence: 1 });
    expect(resolveConsensus([{ provider: 'a', value: 11 }, { provider: 'b', value: 9 }])).toMatchObject({ status: 'CONFLICT', agreementCount: 1, confidence: 0.5 });
  });

  it('opens and recovers the circuit breaker after cooldown', () => {
    const breaker = new CircuitBreaker(2, 1000);
    breaker.failure(1000); breaker.failure(1100);
    expect(breaker.state(1500)).toBe('OPEN');
    expect(breaker.canRequest(2200)).toBe(true);
    expect(breaker.state(2200)).toBe('HALF_OPEN');
    breaker.success();
    expect(breaker.state(2201)).toBe('CLOSED');
  });

  it('suppresses duplicate odds but retains changes', () => {
    expect(oddsChanged(null, 1.94)).toBe(true);
    expect(oddsChanged(1.94, 1.94)).toBe(false);
    expect(oddsChanged(1.94, 1.91)).toBe(true);
  });

  it('normalizes goal, corner, card and 1X2 markets generically', () => {
    const result = normalizeIddaaMarkets('m1', [
      { name: 'Maç Sonucu', selections: [{ name: '1', odds: '1,80' }, { name: 'X', odds: 3.2 }] },
      { name: 'Toplam Gol 2.5 Alt/Üst', selections: [{ name: 'Üst', odds: 1.94 }] },
      { name: 'Toplam Korner 9.5', selections: [{ name: 'Alt', odds: 1.85 }] },
      { name: 'Toplam Kart 4.5', selections: [{ name: 'Üst', odds: 2.05 }] },
    ]);
    expect(result.map((item) => item.marketType)).toEqual(['MATCH_RESULT', 'MATCH_RESULT', 'TOTAL_GOALS', 'TOTAL_CORNERS', 'TOTAL_CARDS']);
    expect(result[2]).toMatchObject({ line: 2.5, oddsDecimal: 1.94 });
  });
});
