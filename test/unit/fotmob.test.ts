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
});
