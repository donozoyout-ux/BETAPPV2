import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { competitionKey } from '../../src/matching/competition.js';
import { FotMobProvider, fotmobCompetitions } from '../../src/providers/fotmob.js';

afterEach(() => vi.unstubAllGlobals());

describe('configured club and international competition support', () => {
  it('keeps Brasileirao, removes MLS, and enables national-team competitions by default', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp' });
    expect(config.SUPPORTED_COMPETITIONS).not.toContain('MLS');
    expect(config.SUPPORTED_COMPETITIONS).toContain('BrasileiraoSerieA');
    expect(config.SUPPORTED_COMPETITIONS).toEqual(expect.arrayContaining([
      'WorldCup','EURO','EUROQualification','UefaNationsLeagueA','UefaNationsLeagueB','UefaNationsLeagueC','UefaNationsLeagueD',
      'WorldCupQualificationUEFA','CopaAmerica','WorldCupQualificationCONMEBOL','InternationalFriendlies',
      'Eredivisie','BelgianProLeague','DanishSuperliga','Allsvenskan','GreekSuperLeague',
    ]));
    expect(fotmobCompetitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 268, key: 'BrasileiraoSerieA', name: 'Brasileirão Série A' }),
      expect.objectContaining({ id: 77, key: 'WorldCup', name: 'FIFA World Cup' }),
      expect.objectContaining({ id: 9806, key: 'UefaNationsLeagueA', name: 'UEFA Nations League A' }),
    ]));
    expect(fotmobCompetitions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 130, key: 'MLS' }),
    ]));
  });

  it('migrates old Render defaults and silently drops legacy MLS from custom subsets', () => {
    const legacy = 'PremierLeague,LaLiga,Bundesliga,SerieA,Ligue1,SuperLig,ChampionsLeague,EuropaLeague,ConferenceLeague';
    const upgraded = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', SUPPORTED_COMPETITIONS: legacy });
    expect(upgraded.SUPPORTED_COMPETITIONS).toEqual([
      'PremierLeague','LaLiga','Bundesliga','SerieA','Ligue1','SuperLig',
      'ChampionsLeague','EuropaLeague','ConferenceLeague','BrasileiraoSerieA',
      'WorldCup','EURO','EUROQualification','UefaNationsLeagueA','UefaNationsLeagueB','UefaNationsLeagueC','UefaNationsLeagueD',
      'WorldCupQualificationUEFA','CopaAmerica','WorldCupQualificationCONMEBOL','InternationalFriendlies',
      'Eredivisie','BelgianProLeague','DanishSuperliga','Allsvenskan','GreekSuperLeague',
    ]);

    const custom = loadConfig({
      DATABASE_URL: 'postgresql://localhost/betapp',
      SUPPORTED_COMPETITIONS: 'PremierLeague,MLS',
    });
    expect(custom.SUPPORTED_COMPETITIONS).toEqual(['PremierLeague']);
  });

  it('keeps Brazilian Serie A distinct from Italian Serie A', () => {
    expect(competitionKey('Serie A')).toBe('serie_a');
    expect(competitionKey('Brasileirão Série A')).toBe('brasileirao_serie_a');
    expect(competitionKey('Campeonato Brasileiro Serie A')).toBe('brasileirao_serie_a');
    expect(competitionKey('Major League Soccer')).toBe('mls');
  });

  it('canonicalizes ambiguous FotMob Serie A names by league id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ leagues: [
      { id: 55, primaryId: 55, name: 'Serie A', ccode: 'ITA', matches: [{
        id: 1001, home: { id: 1, name: 'Inter' }, away: { id: 2, name: 'Milan' },
        status: { utcTime: '2026-09-21T18:00:00Z' },
      }] },
      { id: 268, primaryId: 268, name: 'Serie A', ccode: 'BRA', matches: [{
        id: 2001, home: { id: 3, name: 'Flamengo' }, away: { id: 4, name: 'Palmeiras' },
        status: { utcTime: '2026-09-21T22:00:00Z' },
      }] },
      { id: 130, primaryId: 130, name: 'MLS', ccode: 'USA', matches: [{
        id: 3001, home: { id: 5, name: 'Inter Miami' }, away: { id: 6, name: 'Seattle Sounders' },
        status: { utcTime: '2026-09-22T00:00:00Z' },
      }] },
    ] }), { status: 200 })));

    const config = loadConfig({
      DATABASE_URL: 'postgresql://localhost/betapp',
      LOG_LEVEL: 'silent',
      PROVIDER_REQUESTS_PER_SECOND: '10',
      PROVIDER_MAX_RETRIES: '0',
    });
    const provider = new FotMobProvider(config, createLogger(config));
    const matches = await provider.getFixtures({ date: new Date('2026-09-21T00:00:00Z') });
    expect(matches.map((item) => item.league.name)).toEqual(['Serie A', 'Brasileirão Série A']);
    expect(matches.map((item) => competitionKey(item.league.name))).toEqual([
      'serie_a', 'brasileirao_serie_a',
    ]);
  });
});
