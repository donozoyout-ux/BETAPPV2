import { describe, expect, it, vi } from 'vitest';
import { OddsRepository } from '../../src/db/odds-repository.js';
import type { OddsFixture } from '../../src/domain/odds.js';

const kickoff = new Date('2099-01-01T18:00:00Z');
const fixture: OddsFixture = { providerMatchId: 'ng', kickoffAt: kickoff, leagueName: 'Brasileirao', homeTeam: 'Flamengo', awayTeam: 'RB Bragantino' };
const candidate = { id: 'internal', kickoff_at: kickoff, home_team: 'Flamengo', away_team: 'RB Bragantino', league: 'Brasileirao' };
function repository(rows: Array<typeof candidate>) {
  return new OddsRepository({ query: vi.fn().mockResolvedValue({ rows }) } as never, undefined, undefined,
    ['BrasileiraoSerieA','InternationalFriendlies']);
}

describe('NowGoal conservative match linking', () => {
  it('retains exact matching and legacy wrapper', async () => {
    const repo = repository([candidate]);
    expect(await repo.resolveMatchDetailed(fixture)).toMatchObject({ matchId: 'internal', status: 'EXACT', kickoffDifferenceMinutes: 0 });
    expect(await repo.resolveMatch(fixture)).toBe('internal');
  });
  it.each([['CR Flamengo','Red Bull Bragantino'],['Flamengo RJ','Bragantino SP']])('links safe club aliases %s / %s', async (homeTeam,awayTeam) => {
    expect(await repository([candidate]).resolveMatchDetailed({ ...fixture, homeTeam, awayTeam }))
      .toMatchObject({ status: 'ALIAS', matchId: 'internal' });
  });
  it('links national-team aliases', async () => {
    expect(await repository([{ ...candidate, home_team: 'Türkiye', away_team: 'Czechia', league: 'International Friendlies' }])
      .resolveMatchDetailed({ ...fixture, homeTeam: 'Turkey', awayTeam: 'Czech Republic' })).toMatchObject({ status: 'ALIAS', matchId: 'internal' });
  });
  it('allows only harmless token containment', async () => {
    expect(await repository([candidate]).resolveMatchDetailed({ ...fixture, homeTeam: 'Flamengo Football Club' }))
      .toMatchObject({ status: 'TOKEN_UNIQUE' });
  });
  it('rejects kickoff differences above 30 minutes', async () => {
    expect(await repository([{ ...candidate, kickoff_at: new Date(kickoff.getTime()+31*60_000) }]).resolveMatchDetailed(fixture))
      .toMatchObject({ matchId: null, reason: 'KICKOFF_MISMATCH' });
  });
  it.each([['RB Bragantino','Flamengo'],['Flamengoo','RB Bragantino'],['Flamengo U21','RB Bragantino'],['Flamengo Women','RB Bragantino']])('never guesses or swaps %s / %s', async (homeTeam,awayTeam) => {
      expect(await repository([candidate]).resolveMatchDetailed({ ...fixture, homeTeam, awayTeam })).toMatchObject({ matchId: null, reason: 'TEAM_MISMATCH' });
    });
  it('blocks ambiguous candidates', async () => {
    expect(await repository([candidate,{ ...candidate,id:'other' }]).resolveMatchDetailed(fixture))
      .toMatchObject({ matchId: null,status:'AMBIGUOUS' });
  });
  it('blocks old MLS rows and reports absent candidates', async () => {
    expect(await repository([{ ...candidate,league:'MLS' }]).resolveMatchDetailed(fixture)).toMatchObject({ matchId:null,status:'INACTIVE_COMPETITION' });
    expect(await repository([]).resolveMatchDetailed(fixture)).toMatchObject({ matchId:null,reason:'NO_INTERNAL_CANDIDATE' });
  });
});
