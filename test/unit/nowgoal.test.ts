import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { normalizeNowgoalOddsRows, NowgoalProvider } from '../../src/providers/nowgoal.js';

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
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', NOWGOAL_COMPANY_IDS: '22' });
    const provider = new NowgoalProvider(config, createLogger({ ...config, LOG_LEVEL: 'silent' }, 'test'));
    const matches = await provider.getPrematchOddsForDate(new Date('2026-09-18T00:00:00Z'));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.fixture).toMatchObject({ providerMatchId: 'm1', homeTeam: 'Arsenal', awayTeam: 'Chelsea' });
    expect(matches[0]!.odds).toHaveLength(2);
  });
});
