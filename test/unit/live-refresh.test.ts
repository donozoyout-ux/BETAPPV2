import { afterEach, expect, it, vi } from 'vitest';
import { FotMobProvider } from '../../src/providers/fotmob.js';
import { LiveRefresh } from '../../src/live/refresh.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent',
  PROVIDER_REQUESTS_PER_SECOND: '10', PROVIDER_MAX_RETRIES: '0' });
afterEach(() => vi.unstubAllGlobals());
it('refreshes national-team live scores and stats with no historical/prediction hooks', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('matchDetails')
    ? { header: { status: { started: true } }, content: {} }
    : { leagues: [{ id: 9806, primaryId: 9806, name: 'UEFA Nations League A', matches: [{ id: 123,
      home: { id: 1, name: 'Türkiye', score: 2 }, away: { id: 2, name: 'France', score: 1 },
      status: { utcTime: '2026-09-23T18:00:00Z', started: true } }] }] }))));
  const repository = { upsertMatch: vi.fn(), upsertStatistics: vi.fn() };
  await new LiveRefresh(new FotMobProvider(config, createLogger(config)), repository as never, createLogger(config)).runCycle();
  expect(repository.upsertMatch).toHaveBeenCalledWith('fotmob', expect.objectContaining({
    status: 'live', homeScore: 2, awayScore: 1, league: expect.objectContaining({ name: 'UEFA Nations League A' }),
  }));
  expect(repository.upsertStatistics).toHaveBeenCalledWith('fotmob', expect.objectContaining({ statistics: [] }));
});

