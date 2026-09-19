import { describe, expect, it, vi } from 'vitest';
import { OddsCollector } from '../../src/collector/odds-collector.js';
import { loadConfig } from '../../src/config.js';
import type { OddsRepository } from '../../src/db/odds-repository.js';
import type { FootballRepository } from '../../src/db/repository.js';
import type { MatchOdds } from '../../src/domain/odds.js';
import { createLogger } from '../../src/logger.js';
import type { NowgoalProvider } from '../../src/providers/nowgoal.js';

describe('OddsCollector ODDS_V1 integration', () => {
  it('resolves fixtures, persists odds and continues after one analysis failure', async () => {
    const date = new Date('2026-09-20T12:00:00Z');
    const match = (id: string): MatchOdds => ({ fixture: { providerMatchId: id, kickoffAt: date,
      homeTeam: `Home ${id}`, awayTeam: `Away ${id}`, leagueName: 'Premier League' }, odds: [{ provider: 'nowgoal:pinnacle',
      providerMatchId: id, marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME',
      oddsDecimal: 2, capturedAt: date }] });
    const provider = { name: 'nowgoal', healthCheck: vi.fn().mockResolvedValue({ provider: 'nowgoal', ok: true,
      latencyMs: 1, message: 'ok' }), getPrematchOddsForDate: vi.fn().mockResolvedValueOnce([match('one'), match('two')])
      .mockResolvedValue([]), consumeRetryCount: vi.fn().mockReturnValue(0) } as unknown as NowgoalProvider;
    const oddsRepository = { resolveMatch: vi.fn(async (fixture: { providerMatchId: string }) => `internal-${fixture.providerMatchId}`),
      appendManyAndAnalyze: vi.fn().mockResolvedValueOnce({ inserted: 1, analysisGenerated: false, analysisFailed: true })
        .mockResolvedValueOnce({ inserted: 1, analysisGenerated: true, analysisFailed: false })
    } as unknown as OddsRepository;
    const repository = { markStarted: vi.fn(), updateProviderStatus: vi.fn(), markSucceeded: vi.fn(),
      markProviderFetch: vi.fn(), markFailed: vi.fn() } as unknown as FootballRepository;
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', NOWGOAL_FUTURE_DAYS: '0' });
    const collector = new OddsCollector(provider, oddsRepository, repository, config,
      createLogger({ ...config, LOG_LEVEL: 'silent' }, 'test'));

    await collector.runCycle();

    expect(oddsRepository.resolveMatch).toHaveBeenCalledTimes(2);
    expect(oddsRepository.appendManyAndAnalyze).toHaveBeenCalledTimes(2);
    expect(repository.markSucceeded).toHaveBeenCalledWith('nowgoal', 'prematch-odds', expect.objectContaining({
      matched: 2, snapshots: 2, analyses: 1, analysisFailures: 1,
    }));
  });
});
