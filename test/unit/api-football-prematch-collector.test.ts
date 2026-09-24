import { describe, expect, it, vi } from 'vitest';
import { ApiFootballPrematchOddsCollector } from '../../src/collector/api-football-odds-collector.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import type { ApiFixture, ApiFootballProvider } from '../../src/providers/api-football.js';
import type { OddsRepository } from '../../src/db/odds-repository.js';
import type { FootballRepository } from '../../src/db/repository.js';

function fixture(id: string, kickoff: string): ApiFixture {
  return {
    snapshot:{provider:'api-football',externalId:id,status:'scheduled',phase:'UNKNOWN',
      homeScore:null,awayScore:null,minute:null,addedTime:null,observedAt:'2026-09-24T12:00:00Z'},
    league:'Premier League',kickoffAt:kickoff,homeTeam:`Home ${id}`,awayTeam:`Away ${id}`,homeId:1,awayId:2,
  };
}

describe('API-Football prematch odds collector', () => {
  it('rotates by oldest collection attempt, persists real snapshots and does not exceed the cycle cap', async () => {
    const a=fixture('a','2099-01-01T18:00:00Z'), b=fixture('b','2099-01-01T19:00:00Z');
    const provider={
      configured:true,health:'SUPPORTED',
      fixturesForDate:vi.fn().mockResolvedValueOnce([a,b]).mockResolvedValue([]),
      prematchOdds:vi.fn(async (f:ApiFixture)=>({fixture:{providerMatchId:f.snapshot.externalId,kickoffAt:new Date(f.kickoffAt),
        homeTeam:f.homeTeam,awayTeam:f.awayTeam,leagueName:f.league},odds:[{
          provider:'api-football:pinnacle',providerMatchId:f.snapshot.externalId,marketType:'MATCH_RESULT',
          marketName:'1X2',line:null,selection:'HOME',oddsDecimal:2,capturedAt:new Date('2098-12-31T12:00:00Z')
        }]})),
    } as unknown as ApiFootballProvider;
    const oddsRepository={
      resolveMatchDetailed:vi.fn(async (f:{providerMatchId:string})=>({matchId:`m-${f.providerMatchId}`,reason:'MATCHED_EXACT',
        homeSimilarity:1,awaySimilarity:1,kickoffMinutes:0})),
      collectionStates:vi.fn(async ()=>new Map([
        ['m-a',{lastAttemptAt:new Date('2098-12-31T15:00:00Z'),lastSuccessAt:null,snapshotsInserted:0}],
        ['m-b',{lastAttemptAt:null,lastSuccessAt:null,snapshotsInserted:0}],
      ])),
      appendManyAndAnalyze:vi.fn().mockResolvedValue({inserted:1,analysisGenerated:true,analysisFailed:false}),
      markCollectionState:vi.fn(),
    } as unknown as OddsRepository;
    const repository={markStarted:vi.fn(),markSucceeded:vi.fn(),markFailed:vi.fn(),markProviderFetch:vi.fn()} as unknown as FootballRepository;
    const config=loadConfig({DATABASE_URL:'postgresql://localhost/test',API_FOOTBALL_ENABLED:'true',API_FOOTBALL_KEY:'secret',
      API_FOOTBALL_PREMATCH_ODDS_ENABLED:'true',API_FOOTBALL_PREMATCH_FUTURE_DAYS:'1',API_FOOTBALL_PREMATCH_MAX_FIXTURES:'1'});
    const collector=new ApiFootballPrematchOddsCollector(provider,oddsRepository,repository,config,
      createLogger({...config,LOG_LEVEL:'silent'},'test'));
    const result=await collector.runCycle();
    expect(result).toMatchObject({state:'SUCCESS',attempted:1,withOdds:1,snapshots:1});
    expect(provider.prematchOdds).toHaveBeenCalledTimes(1);
    expect(provider.prematchOdds).toHaveBeenCalledWith(b);
    expect(oddsRepository.markCollectionState).toHaveBeenCalledWith(expect.objectContaining({
      provider:'api-football',matchId:'m-b',status:'SUCCESS',inserted:1,
    }));
  });

  it('is disabled unless the shared API-Football connection is configured', async () => {
    const provider={configured:false} as unknown as ApiFootballProvider;
    const config=loadConfig({DATABASE_URL:'postgresql://localhost/test'});
    const collector=new ApiFootballPrematchOddsCollector(provider,{} as OddsRepository,{} as FootballRepository,config,
      createLogger({...config,LOG_LEVEL:'silent'},'test'));
    await expect(collector.runCycle()).resolves.toEqual({state:'DISABLED'});
  });
});
