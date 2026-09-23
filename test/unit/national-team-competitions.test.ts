import { describe, expect, it } from 'vitest';
import { competitionKey, isCompetitionConfigured } from '../../src/matching/competition.js';

describe('national-team competition mapping', () => {
  it('normalizes supported national-team competition names', () => {
    expect(competitionKey('FIFA World Cup')).toBe('world_cup');
    expect(competitionKey('UEFA EURO')).toBe('euro');
    expect(competitionKey('EURO Qualification')).toBe('euro_qualification');
    expect(competitionKey('UEFA Nations League A')).toBe('uefa_nations_league_a');
    expect(competitionKey('World Cup Qualification UEFA')).toBe('world_cup_qualification_uefa');
    expect(competitionKey('Copa America')).toBe('copa_america');
    expect(competitionKey('World Cup Qualification CONMEBOL')).toBe('world_cup_qualification_conmebol');
    expect(competitionKey('International Friendlies')).toBe('friendlies');
  });

  it('enables only configured national-team competitions', () => {
    const configured = ['WorldCup','EURO','EUROQualification','UefaNationsLeagueA',
      'WorldCupQualificationUEFA','CopaAmerica','WorldCupQualificationCONMEBOL','InternationalFriendlies'];
    expect(isCompetitionConfigured('FIFA World Cup', configured)).toBe(true);
    expect(isCompetitionConfigured('EURO Qualification', configured)).toBe(true);
    expect(isCompetitionConfigured('Copa America', configured)).toBe(true);
    expect(isCompetitionConfigured('World Cup Qualification CONMEBOL', configured)).toBe(true);
    expect(isCompetitionConfigured('AFC Asian Cup', configured)).toBe(false);
  });
});
