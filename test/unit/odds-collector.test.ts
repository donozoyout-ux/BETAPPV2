import { describe, expect, it, vi } from 'vitest';
import { OddsCollector } from '../../src/collector/odds-collector.js';
import { loadConfig } from '../../src/config.js';
import type { OddsRepository } from '../../src/db/odds-repository.js';
import type { FootballRepository } from '../../src/db/repository.js';
import type { MatchOdds } from '../../src/domain/odds.js';
import { createLogger } from '../../src/logger.js';
import type { NowgoalProvider } from '../../src/providers/nowgoal.js';
import type { Logger } from '../../src/logger.js';

function captureLogger() {
  const entries: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
  const logger = {
    info: (fields: Record<string, unknown>, message: string) => entries.push({ level: 'info', fields, message }),
    warn: (fields: Record<string, unknown>, message: string) => entries.push({ level: 'warn', fields, message }),
    error: (fields: Record<string, unknown>, message: string) => entries.push({ level: 'error', fields, message }),
  } as unknown as Logger;
  return { entries, logger };
}

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

  it('logs safe selected, skipped, snapshot, and analysis stages without odds values', async () => {
    const kickoff = new Date('2099-01-01T18:00:00Z');
    const odds = [{ provider: 'nowgoal:pinnacle', providerMatchId: 'provider-secret-id', marketType: 'MATCH_RESULT',
      marketName: '1X2', line: null, selection: 'HOME', oddsDecimal: 2.37, capturedAt: new Date('2098-12-31T12:00:00Z') }];
    const provider = { name: 'nowgoal', healthCheck: vi.fn().mockResolvedValue({ provider: 'nowgoal', ok: true,
      latencyMs: 1, message: 'ok' }), getPrematchOddsForDate: vi.fn().mockResolvedValueOnce([
      { fixture: { providerMatchId: 'provider-secret-id', kickoffAt: kickoff, homeTeam: 'Home', awayTeam: 'Away',
        leagueName: 'Premier League' }, odds },
      { fixture: { providerMatchId: 'unmatched', kickoffAt: kickoff, homeTeam: 'Other', awayTeam: 'Teams',
        leagueName: 'Premier League' }, odds },
    ]).mockResolvedValue([]), consumeRetryCount: vi.fn().mockReturnValue(0) } as unknown as NowgoalProvider;
    const oddsRepository = { resolveMatchDetailed: vi.fn()
      .mockResolvedValueOnce({ matchId: 'internal-match-1', reason: 'MATCHED_EXACT' })
      .mockResolvedValueOnce({ matchId: null, reason: 'TEAM_MISMATCH' }),
    appendManyAndAnalyze: vi.fn().mockResolvedValue({ inserted: 1, analysisGenerated: true, analysisFailed: false }) } as unknown as OddsRepository;
    const repository = { markStarted: vi.fn(), updateProviderStatus: vi.fn(), markSucceeded: vi.fn(),
      markProviderFetch: vi.fn(), markFailed: vi.fn() } as unknown as FootballRepository;
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', NOWGOAL_FUTURE_DAYS: '0' });
    const { entries, logger } = captureLogger();
    await new OddsCollector(provider, oddsRepository, repository, config, logger).runCycle();
    const events = entries.map((entry) => entry.fields.event);
    for (const event of ['PREMATCH_ODDS_CYCLE_START', 'PREMATCH_FIXTURE_CANDIDATE', 'PREMATCH_FIXTURE_SELECTED',
      'PREMATCH_FIXTURE_SKIPPED', 'PREMATCH_SNAPSHOT_WRITTEN', 'PREMATCH_ANALYSIS_CREATED', 'PREMATCH_CYCLE_END']) {
      expect(events).toContain(event);
    }
    expect(entries.find((entry) => entry.fields.event === 'PREMATCH_FIXTURE_SKIPPED')?.fields.reason).toBe('TEAM_MISMATCH');
    expect(entries.find((entry) => entry.fields.event === 'PREMATCH_SNAPSHOT_WRITTEN')?.fields.count).toBe(1);
    expect(entries.find((entry) => entry.fields.event === 'PREMATCH_ANALYSIS_CREATED')?.fields.created).toBe(true);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('2.37');
    expect(serialized).not.toContain('provider-secret-id');
  });
});
