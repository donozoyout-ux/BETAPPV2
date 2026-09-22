import { describe, expect, it, vi } from 'vitest';
import { OddsCollector } from '../../src/collector/odds-collector.js';
import { loadConfig } from '../../src/config.js';
import type { OddsRepository } from '../../src/db/odds-repository.js';
import type { FootballRepository } from '../../src/db/repository.js';
import type { MatchOdds } from '../../src/domain/odds.js';
import { createLogger } from '../../src/logger.js';
import type { NowgoalProvider } from '../../src/providers/nowgoal.js';

describe('OddsCollector ODDS_V1 integration', () => {
  it('blocks ambiguous fixtures without persistence and caps diagnostic logs', async () => {
    const fixture = { providerMatchId:'ambiguous',kickoffAt:new Date('2099-01-01'),homeTeam:'Home',awayTeam:'Away',leagueName:'Premier League' };
    const provider = { name:'nowgoal',healthCheck:vi.fn().mockResolvedValue({provider:'nowgoal',ok:true,latencyMs:1}),
      getPrematchOddsForDate:vi.fn().mockResolvedValue(Array.from({length:15},()=>({fixture,odds:[]}))),consumeRetryCount:()=>0 };
    const odds = { resolveMatchDetailed:vi.fn().mockResolvedValue({matchId:null,status:'AMBIGUOUS',reason:'AMBIGUOUS',nearestCandidates:[]}),
      appendManyAndAnalyze:vi.fn() };
    const repository = { markStarted:vi.fn(),updateProviderStatus:vi.fn(),markSucceeded:vi.fn(),markProviderFetch:vi.fn(),markFailed:vi.fn() };
    const logger = { info:vi.fn(),error:vi.fn() };
    const config = loadConfig({DATABASE_URL:'postgresql://localhost/test',NOWGOAL_FUTURE_DAYS:'0'});
    await new OddsCollector(provider as never,odds as never,repository as never,config,logger as never).runCycle();
    expect(odds.appendManyAndAnalyze).not.toHaveBeenCalled();
    expect(logger.info.mock.calls.filter((call)=>call[1]==='NowGoal fixture not linked')).toHaveLength(10);
    expect(repository.markSucceeded).toHaveBeenCalledWith('nowgoal','prematch-odds',expect.objectContaining({unmatched:15,reasons:{AMBIGUOUS:15}}));
  });
  it('drops post-kickoff snapshots and never persists an already started fixture', async () => {
    const kickoff = new Date('2099-01-01');
    const fixture = {providerMatchId:'ng',kickoffAt:kickoff,homeTeam:'Home',awayTeam:'Away',leagueName:'Premier League'};
    const snapshot = {provider:'nowgoal',providerMatchId:'ng',marketType:'MATCH_RESULT',marketName:'1X2',line:null,selection:'HOME',oddsDecimal:2,
      capturedAt:new Date(kickoff.getTime()-1000)};
    const provider = {name:'nowgoal',healthCheck:async()=>({provider:'nowgoal',ok:true,latencyMs:1}),consumeRetryCount:()=>0,
      getPrematchOddsForDate:async()=>[{fixture,odds:[snapshot,{...snapshot,capturedAt:kickoff}]},
        {fixture:{...fixture,kickoffAt:new Date('2000-01-01')},odds:[snapshot]}]};
    const odds = {resolveMatchDetailed:async()=>({matchId:'internal',status:'EXACT',reason:'EXACT',kickoffAt:kickoff,nearestCandidates:[]}),
      appendManyAndAnalyze:vi.fn().mockResolvedValue({inserted:1,analysisGenerated:true,analysisFailed:false})};
    const repository = {markStarted:vi.fn(),updateProviderStatus:vi.fn(),markSucceeded:vi.fn(),markProviderFetch:vi.fn(),markFailed:vi.fn()};
    const config = loadConfig({DATABASE_URL:'postgresql://localhost/test',NOWGOAL_FUTURE_DAYS:'0'});
    await new OddsCollector(provider as never,odds as never,repository as never,config,{info:vi.fn()} as never).runCycle();
    expect(odds.appendManyAndAnalyze).toHaveBeenCalledExactlyOnceWith('internal',[snapshot]);
  });
  it('resolves fixtures, persists odds and continues after one analysis failure', async () => {
    const date = new Date('2099-09-20T12:00:00Z');
    const match = (id: string): MatchOdds => ({ fixture: { providerMatchId: id, kickoffAt: date,
      homeTeam: `Home ${id}`, awayTeam: `Away ${id}`, leagueName: 'Premier League' }, odds: [{ provider: 'nowgoal:pinnacle',
      providerMatchId: id, marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME',
      oddsDecimal: 2, capturedAt: new Date(date.getTime()-60_000) }] });
    const provider = { name: 'nowgoal', healthCheck: vi.fn().mockResolvedValue({ provider: 'nowgoal', ok: true,
      latencyMs: 1, message: 'ok' }), getPrematchOddsForDate: vi.fn().mockResolvedValueOnce([match('one'), match('two')])
      .mockResolvedValue([]), consumeRetryCount: vi.fn().mockReturnValue(0) } as unknown as NowgoalProvider;
    const oddsRepository = { resolveMatchDetailed: vi.fn(async (fixture: { providerMatchId: string }) => ({
      matchId: `internal-${fixture.providerMatchId}`, reason: 'EXACT', status: 'EXACT', kickoffAt: date, nearestCandidates: [] })),
      appendManyAndAnalyze: vi.fn().mockResolvedValueOnce({ inserted: 1, analysisGenerated: false, analysisFailed: true })
        .mockResolvedValueOnce({ inserted: 1, analysisGenerated: true, analysisFailed: false })
    } as unknown as OddsRepository;
    const repository = { markStarted: vi.fn(), updateProviderStatus: vi.fn(), markSucceeded: vi.fn(),
      markProviderFetch: vi.fn(), markFailed: vi.fn() } as unknown as FootballRepository;
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', NOWGOAL_FUTURE_DAYS: '0' });
    const collector = new OddsCollector(provider, oddsRepository, repository, config,
      createLogger({ ...config, LOG_LEVEL: 'silent' }, 'test'));

    await collector.runCycle();

    expect(oddsRepository.resolveMatchDetailed).toHaveBeenCalledTimes(2);
    expect(oddsRepository.appendManyAndAnalyze).toHaveBeenCalledTimes(2);
    expect(repository.markSucceeded).toHaveBeenCalledWith('nowgoal', 'prematch-odds', expect.objectContaining({
      matched: 2, snapshots: 2, analyses: 1, analysisFailures: 1,
    }));
  });
});
