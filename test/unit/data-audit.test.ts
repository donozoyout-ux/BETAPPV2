import { describe, expect, it } from 'vitest';
import { auditDataset } from '../../src/data/audit.js';
import type { HistoricalCornerMatch } from '../../src/corners/types.js';

function historical(index: number): HistoricalCornerMatch {
  return { matchId: `audit-${index}`, competitionId: 'league', competitionName: 'League', season: '2025/26',
    kickoffAt: new Date(Date.UTC(2025, 7, index + 1)), homeTeamId: `team-${index % 4}`, awayTeamId: `team-${(index + 1) % 4}`,
    homeGoals: 1, awayGoals: 0, homeCorners: index === 0 ? null : 4 + index % 3, awayCorners: index === 0 ? null : 3 + index % 2,
    firstHalfHomeCorners: null, firstHalfAwayCorners: null, homeXg: 1.2, awayXg: 0.8,
    homeShots: 12, awayShots: 8, homeShotsOnTarget: 5, awayShotsOnTarget: 3, homePossession: 54, awayPossession: 46,
    homeFouls: 10, awayFouls: 11, homeYellowCards: 2, awayYellowCards: 3, homeRedCards: 0, awayRedCards: 0,
    provider: 'fotmob', sourceTimestamp: new Date() };
}

describe('dataset audit', () => {
  it('reports coverage, samples, distribution and league dispersion without dropping partial rows', () => {
    const report = auditDataset(Array.from({ length: 24 }, (_, index) => historical(index)));
    expect(report.totalMatches).toBe(24);
    expect(report.cornerCoverage.complete.count).toBe(23);
    expect(report.cornerCoverage.missing.count).toBe(1);
    expect(report.samples.teamsCount).toBe(4);
    expect(report.samples.availability.last10.count).toBe(4);
    expect(report.samples.availability.last20.count).toBe(0);
    expect(report.cornerDistribution.mean).toBeGreaterThan(0);
    expect(report.leagueBaselines[0]?.dispersionRatio).toBeGreaterThanOrEqual(0);
    expect(report.leagueBaselines[0]?.selectedDistribution).toMatch(/POISSON|NEGATIVE_BINOMIAL/);
  });
});
