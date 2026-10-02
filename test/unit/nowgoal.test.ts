import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import type { Logger } from '../../src/logger.js';
import { normalizeNowgoalOddsRows, NowgoalProvider } from '../../src/providers/nowgoal.js';

function captureLogger() {
  const entries: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
  const logger = {
    info: (fields: Record<string, unknown>, message: string) => entries.push({ level: 'info', fields, message }),
    warn: (fields: Record<string, unknown>, message: string) => entries.push({ level: 'warn', fields, message }),
    error: (fields: Record<string, unknown>, message: string) => entries.push({ level: 'error', fields, message }),
  } as unknown as Logger;
  return { entries, logger };
}

afterEach(() => vi.unstubAllGlobals());

describe('Nowgoal odds provider', () => {
  it('normalizes 1X2 and converts Hong Kong prices for goal and corner totals', () => {
    const capturedAt = new Date('2026-09-17T12:00:00Z');
    const odds = normalizeNowgoalOddsRows([
      { ScheduleID: 'm1', CompanyID: 22, Type: '1x2', UpOdds: '2.10', Goal: '3.20', DownOdds: '3.40' },
      { ScheduleID: 'm1', CompanyID: 22, Type: 'OU', UpOdds: '0.83', Goal: '2.50', DownOdds: '0.97' },
      { ScheduleID: 'm1', CompanyID: 14, Type: 'CR', UpOdds: '0.91', Goal: '9.50', DownOdds: '0.89' },
    ], undefined, capturedAt);
    expect(odds).toHaveLength(7);
    expect(odds[0]).toMatchObject({ provider: 'nowgoal:pinnacle', marketType: 'MATCH_RESULT', selection: 'HOME', oddsDecimal: 2.1 });
    expect(odds.find((item) => item.marketType === 'TOTAL_GOALS' && item.selection === 'OVER'))
      .toMatchObject({ line: 2.5, oddsDecimal: 1.83 });
    expect(odds.find((item) => item.marketType === 'TOTAL_CORNERS' && item.selection === 'UNDER'))
      .toMatchObject({ provider: 'nowgoal:12bet', line: 9.5, oddsDecimal: 1.89 });
  });

  it('joins scheduled fixtures and odds by ScheduleID', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (decodeURIComponent(url).includes('/match/diary')) return new Response(JSON.stringify({ data: {
        leagues: [{ sclassID: 'league1', leagueName: 'Premier League' }],
        matches: [{ ScheduleID: 'm1', matchTime: '2026-09-18 17:00:00', homeTeam: 'Arsenal',
          guestTeam: 'Chelsea', MatchState: 0, sclassID: 'league1' }],
      } }), { status: 200 });
      return new Response(JSON.stringify({ data: [
        { ScheduleID: 'm1', CompanyID: 22, Type: 'CR', UpOdds: '0.91', Goal: '9.50', DownOdds: '0.89' },
      ] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', NOWGOAL_COMPANY_IDS: '22',
      NOWGOAL_BASE_URL: 'https://nowgoal.test/wp-json/sport-theme-plugin/v1/proxy' });
    const provider = new NowgoalProvider(config, createLogger({ ...config, LOG_LEVEL: 'silent' }, 'test'));
    const matches = await provider.getPrematchOddsForDate(new Date('2026-09-18T00:00:00Z'));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.fixture).toMatchObject({ providerMatchId: 'm1', homeTeam: 'Arsenal', awayTeam: 'Chelsea' });
    expect(matches[0]!.odds).toHaveLength(2);
  });

  it('logs request/response and normalized counts without secrets, raw odds, or provider IDs', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', NOWGOAL_COMPANY_IDS: '2',
      NOWGOAL_BASE_URL: 'https://provider.example.test/proxy?token=private-token',
      API_FOOTBALL_KEY: 'private-api-key', GOOGLE_SHEETS_PRIVATE_KEY: 'private-key-material' });
    const { entries, logger } = captureLogger();
    const provider = new NowgoalProvider(config, logger);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = decodeURIComponent(String(input));
      const body = url.includes('/match/diary') ? { data: { leagues: [{ sclassID: '39', leagueName: 'Premier League' }],
        matches: [{ ScheduleID: 'provider-private-id', matchTime: '2099-01-01 18:00:00', homeTeam: 'Home',
          guestTeam: 'Away', MatchState: 0, sclassID: '39' }] } }
        : { data: [{ ScheduleID: 'provider-private-id', CompanyID: 2, Type: '1x2', UpOdds: '2.11', Goal: '3.22', DownOdds: '4.3' }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await provider.getPrematchOddsForDate(new Date('2099-01-01T00:00:00Z'));
    expect(result).toHaveLength(1);
    expect(result[0]?.odds).toHaveLength(3);
    const events = entries.map((entry) => entry.fields.event);
    expect(events).toContain('PREMATCH_PROVIDER_REQUEST');
    expect(events).toContain('PREMATCH_PROVIDER_RESPONSE');
    expect(events).toContain('PREMATCH_ODDS_NORMALIZED');
    expect(entries.find((entry) => entry.fields.event === 'PREMATCH_PROVIDER_RESPONSE')?.fields.httpStatus).toBe(200);
    expect(entries.find((entry) => entry.fields.event === 'PREMATCH_ODDS_NORMALIZED')?.fields.normalizedQuoteCount).toBe(3);
    const serialized = JSON.stringify(entries);
    for (const secret of ['private-token', 'private-api-key', 'private-key-material', 'provider-private-id', '2.11', '3.22', '4.3']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('logs the actual skip gate when a scheduled fixture has no normalized odds', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', NOWGOAL_COMPANY_IDS: '2',
      NOWGOAL_BASE_URL: 'https://provider.example.test/proxy' });
    const { entries, logger } = captureLogger();
    const provider = new NowgoalProvider(config, logger);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const body = decodeURIComponent(String(input)).includes('/match/diary')
        ? { data: { matches: [{ ScheduleID: 'only-for-hash', matchTime: '2099-01-01 18:00:00', homeTeam: 'A',
          guestTeam: 'B', MatchState: 0 }] } } : { data: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(provider.getPrematchOddsForDate(new Date('2099-01-01T00:00:00Z'))).resolves.toEqual([]);
    expect(entries.find((entry) => entry.fields.event === 'PREMATCH_FIXTURE_SKIPPED')?.fields.reason).toBe('NO_ODDS');
    expect(JSON.stringify(entries)).not.toContain('only-for-hash');
  });

  it('supports direct SoccerAjax endpoint for health check and fixtures with type 4 odds', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', NOWGOAL_BASE_URL: 'https://www.nowgoal26.com' });
    const { entries, logger } = captureLogger();
    const provider = new NowgoalProvider(config, logger);

    const type6Data = 'var A=Array(2);var B=Array(2);A[1]=[1001,1,10,20,\'Arsenal\',\'Chelsea\',\'2026,8,20,15,00,00\',0];B[1]=[1,\'PL\',\'Premier League\'];';
    const type4Data = '1001,8,Bet365#Ear,0,0,,,,,,,0.90,0.50,0.90,0.90,0.50,0.90,,,,,,,0.85,2.50,0.95,0.85,2.50,0.95,,,,,,,2.10,3.40,3.20,2.10,3.40,3.20';

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('type=6')) {
        return new Response(JSON.stringify({ ErrCode: 0, Data: type6Data }), { status: 200 });
      }
      if (url.includes('type=4')) {
        return new Response(JSON.stringify({ ErrCode: 0, Data: type4Data }), { status: 200 });
      }
      return new Response(JSON.stringify({ ErrCode: -1 }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);

    const matches = await provider.getPrematchOddsForDate(new Date('2026-09-20T00:00:00Z'));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.fixture).toMatchObject({
      providerMatchId: '1001',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      leagueName: 'Premier League',
    });
    expect(matches[0]?.odds.length).toBeGreaterThanOrEqual(7);
    expect(matches[0]?.odds.find((o) => o.marketType === 'MATCH_RESULT' && o.selection === 'HOME')?.oddsDecimal).toBe(2.1);
  });
});

