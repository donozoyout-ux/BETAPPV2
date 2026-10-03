import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { NowgoalProvider, parseNowgoalFixtureDiary } from '../../src/providers/nowgoal.js';

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, '__nowgoalExecuted');
});

function directConfig() {
  return loadConfig({
    DATABASE_URL: 'postgresql://localhost/betapp',
    NOWGOAL_BASE_URL: 'https://www.nowgoal26.com',
    LOG_LEVEL: 'silent',
  });
}

function silentProvider() {
  const config = directConfig();
  return new NowgoalProvider(config, createLogger({ ...config, LOG_LEVEL: 'silent' }, 'test'));
}

const maliciousFixture = "var A=Array(1);var B=Array(1);A[1]=[1001,1,10,20,'Arsenal','Chelsea','2026,8,20,15,00,00',0];B[1]=[1,'PL','Premier League'];globalThis.__nowgoalExecuted=true;";
const type4Odds = '1001,8,Bet365#Ear,0,0,,,,,,,0.90,0.50,0.90,0.90,0.50,0.90,,,,,,,0.85,2.50,0.95,0.85,2.50,0.95,,,,,,,2.10,3.40,3.20,2.10,3.40,3.20';

describe('Nowgoal safe fixture parsing', () => {
  it('parses array assignments without executing trailing remote JavaScript', () => {
    const parsed = parseNowgoalFixtureDiary(maliciousFixture);
    expect(parsed.matches.filter(Boolean)).toHaveLength(1);
    expect(parsed.leagues.filter(Boolean)).toHaveLength(1);
    expect(Reflect.get(globalThis, '__nowgoalExecuted')).toBeUndefined();
  });

  it('collects fixtures through the direct path without executing the payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('type=6')) return new Response(JSON.stringify({ ErrCode: 0, Data: maliciousFixture }), { status: 200 });
      if (url.includes('type=4')) return new Response(JSON.stringify({ ErrCode: 0, Data: type4Odds }), { status: 200 });
      return new Response(JSON.stringify({ ErrCode: -1 }), { status: 404 });
    }));

    const matches = await silentProvider().getPrematchOddsForDate(new Date('2026-09-20T00:00:00Z'));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.fixture).toMatchObject({ homeTeam: 'Arsenal', awayTeam: 'Chelsea', leagueName: 'Premier League' });
    expect(matches[0]?.odds.length).toBeGreaterThanOrEqual(7);
    expect(Reflect.get(globalThis, '__nowgoalExecuted')).toBeUndefined();
  });

  it('returns NO_DATA without throwing on a hostile, non-array payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ErrCode: 0, Data: 'this is not array data; globalThis.__nowgoalExecuted=true;' }), { status: 200 })));
    await expect(silentProvider().getPrematchOddsForDate(new Date('2026-09-20T00:00:00Z'))).resolves.toEqual([]);
    expect(Reflect.get(globalThis, '__nowgoalExecuted')).toBeUndefined();
  });

  it('rejects a non-object provider response through schema validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify('not-an-object'), { status: 200 })));
    await expect(silentProvider().getPrematchOddsForDate(new Date('2026-09-20T00:00:00Z'))).resolves.toEqual([]);
  });
});
