import {describe,expect,it,vi} from 'vitest';
import type {AppConfig} from '../../src/config.js';
import {NowgoalLiveOddsCollector} from '../../src/collector/nowgoal-live-odds-collector.js';
import {NowgoalLiveOddsRepository} from '../../src/db/nowgoal-live-odds-repository.js';
import type {Logger} from '../../src/logger.js';

const config={SUPPORTED_COMPETITIONS:['SerieA'],NOWGOAL_LIVE_ODDS_ENABLED:true,GOOGLE_SHEETS_SYNC_MINUTES:5,NOWGOAL_LIVE_ODDS_INTERVAL_SECONDS:30} as unknown as AppConfig;
const logger={info:vi.fn(),warn:vi.fn(),error:vi.fn()} as unknown as Logger;
const obs=[] as never[];

describe('analyzed-only live odds collection',()=>{
  it('fails closed when Prediction V1 tracking table is unavailable',async()=>{
    const pool={query:vi.fn().mockResolvedValueOnce({rows:[{available:false}]})};
    const repository=new NowgoalLiveOddsRepository(pool as never);
    expect(await repository.trackingCandidates(config)).toEqual({configured:false,analyzedMatches:null,matches:[]});
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  it('selects only supported competitions from the analyzed-match query',async()=>{
    const pool={query:vi.fn().mockResolvedValueOnce({rows:[{available:true}]}).mockResolvedValueOnce({rows:[{count:3}]}).mockResolvedValueOnce({rows:[
      {matchId:'a',competition:'Serie A'},{matchId:'b',competition:'Premier League'},
    ]})};
    const result=await new NowgoalLiveOddsRepository(pool as never).trackingCandidates(config);
    expect(result.configured).toBe(true);expect(result.analyzedMatches).toBe(3);expect(result.matches.map((match)=>match.matchId)).toEqual(['a']);
    expect(pool.query.mock.calls[2]?.[0]).toContain('FROM prediction_runs pr');
    expect(pool.query.mock.calls[2]?.[0]).toContain("os.provider LIKE 'nowgoal:%'");
  });
  it('captures analyzed finished matches once and requests the final snapshot',async()=>{
    const match={matchId:'m1',nowgoalMatchId:'2993801',status:'finished',competition:'Serie A',homeTeam:'Home',awayTeam:'Away',kickoffAt:new Date()};
    const repo={trackingCandidates:vi.fn().mockResolvedValue({configured:true,matches:[match]}),
      saveObservations:vi.fn().mockResolvedValue(2),markFinishedCapture:vi.fn().mockResolvedValue(undefined),markCaptureFailure:vi.fn()};
    const provider={getHistory:vi.fn().mockResolvedValue({sourceUrl:'https://live11.nowgoal26.com/match/live-2993801',observations:obs})};
    const sheets={sync:vi.fn().mockResolvedValue({status:'SYNCED',appended:2})};
    const collector=new NowgoalLiveOddsCollector(config,provider as never,repo as never,sheets as never,logger);
    expect(await collector.runCycle()).toMatchObject({tracked:1,captured:1,newObservations:2,sheet:{status:'SYNCED'}});
    expect(provider.getHistory).toHaveBeenCalledWith('2993801');
    expect(repo.markFinishedCapture).toHaveBeenCalledWith('m1','NO_DATA');
  });
});
