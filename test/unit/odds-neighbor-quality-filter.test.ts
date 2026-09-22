import { describe, expect, it } from 'vitest';
import { buildOddsIntelligence, findPastTwins } from '../../src/odds-neighbors/engine.js';
import { oddsNeighborConfig } from '../../src/odds-neighbors/config.js';
import type { HistoricalNeighborInput, MatchOutcomeData, OddsRoute } from '../../src/odds-neighbors/types.js';

const kickoff = new Date('2026-09-22T18:00:00Z');

function route(matchId: string, overrides: Partial<OddsRoute> = {}): OddsRoute {
  return {
    matchId, marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.25, selection: 'UNDER',
    bookmakers: ['a','b','c','d'], openingOdds: 2, latestOdds: 2, snapshots: [],
    openingFairProbability: 0.5, latestFairProbability: 0.5, totalMovementPp: 0,
    genuineObservations: 2, durationMinutes: 60, velocityPpPerHour: 0, directionChanges: 0,
    maximumPullbackPp: 0, monotonicityRatio: 1, bookmakerAgreement: 1, bookmakerDispersionPp: 0,
    lineStability: 1, freshnessMinutes: 10, direction: 'FLAT', strength: 'WEAK', ...overrides,
  };
}

function neighbor(matchId: string, competitionId: string, routeOverrides: Partial<OddsRoute> = {}): HistoricalNeighborInput {
  return {
    matchId, competitionId, kickoffAt: new Date('2026-09-20T18:00:00Z'), league: competitionId,
    homeTeam: `Home ${matchId}`, awayTeam: `Away ${matchId}`, homeScore: 1, awayScore: 0,
    firstHalfHomeScore: null, firstHalfAwayScore: null, homeCorners: 5, awayCorners: 4,
    homeYellowCards: 2, awayYellowCards: 2, homeRedCards: 0, awayRedCards: 0,
    route: route(matchId, routeOverrides),
  };
}

const target: MatchOutcomeData & { route: OddsRoute } = {
  matchId: 'target', competitionId: 'league-a', kickoffAt: kickoff, league: 'League A',
  homeTeam: 'Target Home', awayTeam: 'Target Away', homeScore: null, awayScore: null,
  firstHalfHomeScore: null, firstHalfAwayScore: null, homeCorners: null, awayCorners: null,
  homeYellowCards: null, awayYellowCards: null, homeRedCards: null, awayRedCards: null,
  route: route('target'),
};

describe('Odds Neighbor quality filter', () => {
  it('drops route matches below the configured 70 similarity floor', () => {
    const bad = neighbor('bad', 'league-a', {
      openingOdds: 3, latestOdds: 3, openingFairProbability: 0.9, latestFairProbability: 0.9,
      totalMovementPp: 8, bookmakers: [], bookmakerAgreement: 0, velocityPpPerHour: 4, monotonicityRatio: 0,
    });
    const twins = findPastTwins({ competitionId: target.competitionId, route: target.route }, [bad],
      { mode: 'CLOSEST_NEIGHBORS', limit: 20 });
    expect(oddsNeighborConfig.minimumTwinSimilarity).toBe(70);
    expect(twins).toEqual([]);
  });

  it('uses only same-competition twins when at least five pass the quality floor', () => {
    const same = Array.from({ length: 5 }, (_, index) => neighbor(`same-${index}`, 'league-a'));
    const cross = neighbor('cross', 'league-b');
    const twins = findPastTwins({ competitionId: target.competitionId, route: target.route }, [...same, cross],
      { mode: 'CLOSEST_NEIGHBORS', limit: 20 });
    expect(oddsNeighborConfig.minimumEvidenceSample).toBe(5);
    expect(twins).toHaveLength(5);
    expect(twins.every((item) => item.competitionId === 'league-a')).toBe(true);
  });

  it('falls back to the global pool when fewer than five same-competition twins exist', () => {
    const candidates = [
      neighbor('same', 'league-a'),
      neighbor('cross-1', 'league-b'),
      neighbor('cross-2', 'league-c'),
      neighbor('cross-3', 'league-d'),
      neighbor('cross-4', 'league-e'),
    ];
    const twins = findPastTwins({ competitionId: target.competitionId, route: target.route }, candidates,
      { mode: 'CLOSEST_NEIGHBORS', limit: 20 });
    expect(twins).toHaveLength(5);
    expect(twins.some((item) => item.competitionId !== 'league-a')).toBe(true);
    expect(twins.every((item) => item.similarity >= 70)).toBe(true);
  });

  it('does not turn fewer than five twins into ODDS_TWINS support/conflict evidence', () => {
    const result = buildOddsIntelligence(target, [neighbor('one', 'league-a')],
      { mode: 'CLOSEST_NEIGHBORS', limit: 20 }, new Date('2026-09-22T17:00:00Z'));
    const twins = result.conflictCheck.find((item) => item.source === 'ODDS_TWINS');
    expect(result.pastTwins).toHaveLength(1);
    expect(result.evidenceStrength).toBe('VERY_LOW');
    expect(twins?.state).toBe('UNAVAILABLE');
    expect(twins?.reason).toContain('en az 5');
  });
});
