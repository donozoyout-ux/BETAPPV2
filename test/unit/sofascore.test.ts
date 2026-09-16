import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { SofascoreProvider } from '../../src/providers/sofascore.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://localhost/betapp',
  LOG_LEVEL: 'silent',
  PROVIDER_REQUESTS_PER_SECOND: '10',
  PROVIDER_MAX_RETRIES: '0',
});

afterEach(() => vi.unstubAllGlobals());

describe('SofascoreProvider', () => {
  it('normalizes fixtures and excludes unsupported competitions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [
      {
        id: 101,
        startTimestamp: 1_800_000_000,
        status: { type: 'notstarted' },
        tournament: { uniqueTournament: { id: 17, name: 'Premier League' }, category: { country: { name: 'England' } } },
        homeTeam: { id: 1, name: 'Home FC', shortName: 'Home' },
        awayTeam: { id: 2, name: 'Away FC', shortName: 'Away' },
        season: { name: '2026/27' },
      },
      {
        id: 102,
        startTimestamp: 1_800_000_000,
        tournament: { uniqueTournament: { id: 999, name: 'Other League' } },
        homeTeam: { id: 3, name: 'Other A' }, awayTeam: { id: 4, name: 'Other B' },
      },
    ] }), { status: 200 })));

    const provider = new SofascoreProvider(config, createLogger(config));
    const fixtures = await provider.getFixtures({ date: new Date('2026-09-16T00:00:00Z') });

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      providerExternalId: '101',
      status: 'scheduled',
      league: { providerExternalId: '17', name: 'Premier League' },
      homeTeam: { providerExternalId: '1', name: 'Home FC' },
    });
  });

  it('normalizes statistics into stable keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      statistics: [{ period: 'ALL', groups: [{ statisticsItems: [
        { name: 'Ball possession', home: '55%', away: '45%' },
        { name: 'Shots on target', home: 6, away: 3 },
      ] }] }],
    }), { status: 200 })));
    const provider = new SofascoreProvider(config, createLogger(config));
    const result = await provider.getMatchStatistics('101');
    expect(result.statistics).toEqual([
      { key: 'ball_possession', label: 'Ball possession', period: 'ALL', homeValue: '55%', awayValue: '45%' },
      { key: 'shots_on_target', label: 'Shots on target', period: 'ALL', homeValue: 6, awayValue: 3 },
    ]);
  });

  it('marks HTTP 403 as BLOCKED during qualification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    const provider = new SofascoreProvider(config, createLogger(config));
    const report = await provider.qualify();
    expect(report.connection).toBe('BLOCKED');
    expect(report.checks.every((item) => item.result === 'BLOCKED' && item.httpStatus === 403)).toBe(true);
  });

  it('marks exhausted HTTP 429 as BLOCKED during qualification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    const provider = new SofascoreProvider(config, createLogger(config));
    const report = await provider.qualify();
    expect(report.connection).toBe('BLOCKED');
    expect(report.checks[0]?.httpStatus).toBe(429);
  });
});
