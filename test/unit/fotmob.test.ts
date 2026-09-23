import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { FotMobProvider } from '../../src/providers/fotmob.js';

const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent',
  PROVIDER_REQUESTS_PER_SECOND: '10', PROVIDER_MAX_RETRIES: '0' });

afterEach(() => vi.unstubAllGlobals());

describe('FotMobProvider', () => {
  it('filters supported leagues and tolerates missing optional fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ leagues: [
      { id: 47, primaryId: 47, name: 'Premier League', ccode: 'ENG', matches: [{ id: 1,
        home: { id: 10, name: 'Man Utd' }, away: { id: 11, name: 'Chelsea' },
        status: { utcTime: '2026-09-18T19:00:00Z', finished: false } }] },
      { id: 999, primaryId: 999, name: 'Other', matches: [{ id: 2, home: { id: 1, name: 'A' },
        away: { id: 2, name: 'B' }, status: { utcTime: '2026-09-18T19:00:00Z' } }] },
    ] }), { status: 200 })));
    const provider = new FotMobProvider(config, createLogger(config));
    const result = await provider.getFixtures({ date: new Date('2026-09-18') });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ providerExternalId: '1', status: 'scheduled', round: null, homeScore: null });
  });

  it('collects configured national-team competitions and ignores unconfigured leagues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ leagues: [
      { id: 9806, primaryId: 9806, name: 'UEFA Nations League A', matches: [{ id: 100,
        home: { id: 1, name: 'Türkiye' }, away: { id: 2, name: 'France' },
        status: { utcTime: '2026-09-25T18:45:00Z', finished: false } }] },
      { id: 10607, primaryId: 10607, name: 'EURO Qualification', matches: [{ id: 101,
        home: { id: 3, name: 'Italy' }, away: { id: 4, name: 'Spain' },
        status: { utcTime: '2026-09-25T20:45:00Z', finished: false } }] },
      { id: 44, primaryId: 44, name: 'Copa America', matches: [{ id: 102,
        home: { id: 5, name: 'Argentina' }, away: { id: 6, name: 'Brazil' },
        status: { utcTime: '2026-09-26T00:00:00Z', finished: false } }] },
      { id: 999, primaryId: 999, name: 'Other International', matches: [{ id: 103,
        home: { id: 7, name: 'A' }, away: { id: 8, name: 'B' },
        status: { utcTime: '2026-09-26T00:00:00Z', finished: false } }] },
    ] }), { status: 200 })));
    const provider = new FotMobProvider(config, createLogger(config));
    const result = await provider.getFixtures({ date: new Date('2026-09-25') });
    expect(result.map((item) => item.league.name)).toEqual([
      'UEFA Nations League A', 'EURO Qualification', 'Copa America',
    ]);
  });

  it('parses completed match statistics and ignores missing groups', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: { stats: { Periods: { All: { stats: [
        { title: 'Top', stats: [{ title: 'Corners', stats: [6, 5] }, { title: 'Expected goals (xG)', stats: ['1.2', '0.8'] }] },
      ] } } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new FotMobProvider(config, createLogger(config));
    const parsed = await provider.getMatchStatistics('1');
    expect(parsed.statistics).toEqual([
      { key: 'corners', label: 'Corners', period: 'ALL', homeValue: 6, awayValue: 5 },
      { key: 'expected_goals_xg', label: 'Expected goals (xG)', period: 'ALL', homeValue: '1.2', awayValue: '0.8' },
    ]);
    await expect(provider.getMatchStatistics('2')).resolves.toMatchObject({ statistics: [] });
  });

  it('uses a short-lived process-local cache for duplicate match-detail reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: { stats: { Periods: { All: { stats: [] } } } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new FotMobProvider(config, createLogger(config));
    await provider.getMatchStatistics('same-match');
    await provider.getMatchStatistics('same-match');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
