import { describe, expect, it, vi } from 'vitest';
import { OddsRepository } from '../../src/db/odds-repository.js';

function repositoryWith(rows: Array<Record<string, unknown>>) {
  const pool = { query: vi.fn().mockResolvedValue({ rows }) };
  return { repository: new OddsRepository(pool as never, undefined, { analyzeAndSave: vi.fn() }), pool };
}

describe('NowGoal match reconciliation', () => {
  const fixture = {
    providerMatchId: 'ng-1',
    kickoffAt: new Date('2026-09-24T18:00:00Z'),
    homeTeam: 'Turkey',
    awayTeam: 'France',
    leagueName: 'UEFA Nations League A',
  };

  it('matches conservative national-team aliases with league and kickoff evidence', async () => {
    const { repository } = repositoryWith([{ id: 'm1', kickoff_at: new Date('2026-09-24T18:05:00Z'),
      home_team: 'Türkiye', away_team: 'France', league: 'UEFA Nations League A' }]);
    await expect(repository.resolveMatchDetailed(fixture)).resolves.toMatchObject({
      matchId: 'm1', reason: 'MATCHED_EXACT',
    });
  });

  it('rejects a league mismatch even when team names match', async () => {
    const { repository } = repositoryWith([{ id: 'm1', kickoff_at: new Date('2026-09-24T18:00:00Z'),
      home_team: 'Türkiye', away_team: 'France', league: 'International Friendlies' }]);
    await expect(repository.resolveMatchDetailed(fixture)).resolves.toMatchObject({
      matchId: null, reason: 'LEAGUE_MISMATCH',
    });
  });

  it('rejects ambiguous candidates rather than guessing', async () => {
    const rows = [
      { id: 'm1', kickoff_at: new Date('2026-09-24T18:00:00Z'), home_team: 'Türkiye', away_team: 'France', league: 'UEFA Nations League A' },
      { id: 'm2', kickoff_at: new Date('2026-09-24T18:01:00Z'), home_team: 'Turkey', away_team: 'France', league: 'UEFA Nations League A' },
    ];
    const { repository } = repositoryWith(rows);
    await expect(repository.resolveMatchDetailed(fixture)).resolves.toMatchObject({
      matchId: null, reason: 'AMBIGUOUS',
    });
  });

  it('rejects weak team-name similarity', async () => {
    const { repository } = repositoryWith([{ id: 'm1', kickoff_at: new Date('2026-09-24T18:00:00Z'),
      home_team: 'Portugal', away_team: 'Spain', league: 'UEFA Nations League A' }]);
    await expect(repository.resolveMatchDetailed(fixture)).resolves.toMatchObject({
      matchId: null, reason: 'TEAM_MISMATCH',
    });
  });
});
