import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { competitionKey, isCompetitionConfigured } from '../../src/matching/competition.js';
import { fotmobCompetitions } from '../../src/providers/fotmob.js';
import { PredictionRepository } from '../../src/predictions/service.js';

describe('international competition configuration', () => {
  it('removes MLS from the default and enables national-team competitions', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp' });
    expect(config.SUPPORTED_COMPETITIONS).not.toContain('MLS');
    expect(config.SUPPORTED_COMPETITIONS).toEqual(expect.arrayContaining([
      'BrasileiraoSerieA', 'WorldCup', 'EURO', 'UefaNationsLeagueA', 'UefaNationsLeagueB',
      'UefaNationsLeagueC', 'UefaNationsLeagueD', 'WorldCupQualificationUEFA', 'InternationalFriendlies',
    ]));
  });

  it('migrates the previous Render default by dropping MLS and adding international competitions', () => {
    const previous = ['PremierLeague','LaLiga','Bundesliga','SerieA','Ligue1','SuperLig',
      'ChampionsLeague','EuropaLeague','ConferenceLeague','MLS','BrasileiraoSerieA'].join(',');
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', SUPPORTED_COMPETITIONS: previous });
    expect(config.SUPPORTED_COMPETITIONS).not.toContain('MLS');
    expect(config.SUPPORTED_COMPETITIONS).toContain('BrasileiraoSerieA');
    expect(config.SUPPORTED_COMPETITIONS).toContain('UefaNationsLeagueA');
    expect(config.SUPPORTED_COMPETITIONS).toContain('InternationalFriendlies');
  });

  it('maps national-team competition names and keeps MLS recognizable only for filtering old rows', () => {
    expect(competitionKey('FIFA World Cup')).toBe('world_cup');
    expect(competitionKey('EURO')).toBe('euro');
    expect(competitionKey('UEFA Nations League A')).toBe('uefa_nations_league_a');
    expect(competitionKey('World Cup Qualification UEFA')).toBe('world_cup_qualification_uefa');
    expect(competitionKey('International Friendlies')).toBe('friendlies');
    expect(isCompetitionConfigured('UEFA Nations League A', ['UefaNationsLeagueA'])).toBe(true);
    expect(isCompetitionConfigured('MLS', ['UefaNationsLeagueA','BrasileiraoSerieA'])).toBe(false);
  });

  it('uses verified FotMob IDs and no longer configures MLS', () => {
    const ids = new Map(fotmobCompetitions.map((item) => [item.key, item.id]));
    expect(ids.get('WorldCup')).toBe(77);
    expect(ids.get('EURO')).toBe(50);
    expect(ids.get('UefaNationsLeagueA')).toBe(9806);
    expect(ids.get('UefaNationsLeagueB')).toBe(9807);
    expect(ids.get('UefaNationsLeagueC')).toBe(9808);
    expect(ids.get('UefaNationsLeagueD')).toBe(9809);
    expect(ids.get('WorldCupQualificationUEFA')).toBe(10195);
    expect(ids.get('InternationalFriendlies')).toBe(114);
    expect([...ids.keys()]).not.toContain('MLS');
    expect([...ids.values()]).not.toContain(130);
  });

  it('excludes stored MLS fixtures from live Prediction V1 targets', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [
      { match_id: 'mls', competition_id: 'l-mls', kickoff_at: '2026-09-23T18:00:00Z',
        competition_name: 'MLS', odds_input_hash: 'a', items: [] },
      { match_id: 'nat', competition_id: 'l-nat', kickoff_at: '2026-09-24T18:45:00Z',
        competition_name: 'UEFA Nations League A', odds_input_hash: 'b', items: [] },
    ] }) };
    const repository = new PredictionRepository(pool as never, ['UefaNationsLeagueA','BrasileiraoSerieA']);
    const targets = await repository.loadTargets();
    expect(targets.map((item) => item.matchId)).toEqual(['nat']);
  });
});
