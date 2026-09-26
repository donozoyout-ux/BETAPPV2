import { describe,it,expect } from 'vitest';
import { historicalNeighbors,scoreNeighbor } from '../../src/odds-neighbors/reliability.js';
import { renderHistoricalNeighbors } from '../../src/odds-neighbors/reliability-view.js';
import { buildOddsIntelligence, calculateEvidenceStrength } from '../../src/odds-neighbors/engine.js';
import { buildOddsRoute } from '../../src/odds-neighbors/features.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import type { HistoricalNeighborInput } from '../../src/odds-neighbors/types.js';
const kickoff=new Date('2030-01-01');
function row(id:string,competitionId='league'):HistoricalNeighborInput {
  const snapshots=['OVER','UNDER'].map(selection=>({matchId:id,provider:'book',marketType:'TOTAL_GOALS',marketName:'Total Goals',line:2.5,selection,oddsDecimal:2,capturedAt:new Date('2028-01-01')}));
  return {matchId:id,competitionId,country:'Country',league:competitionId,homeTeam:'Home',awayTeam:'Away',kickoffAt:new Date('2029-01-01'),
    homeScore:2,awayScore:1,firstHalfHomeScore:null,firstHalfAwayScore:null,homeCorners:null,awayCorners:null,homeYellowCards:null,awayYellowCards:null,homeRedCards:null,awayRedCards:null,
    route:buildOddsRoute(id,kickoff,snapshots,'TOTAL_GOALS','Total Goals',2.5,'OVER',kickoff)!};
}
const target={...row('target'),kickoffAt:kickoff};
const samples=(n:number,league='league')=>Array.from({length:n},(_,i)=>row(String(i),league));
describe('neighbor reliability',()=>{
  it.each([1,2])('%i wins remain insufficient despite 100 percent raw rate',n=>{
    const result=historicalNeighbors(target,samples(n));
    expect(result).toMatchObject({rawWinRate:100,status:'INSUFFICIENT_DATA',usableSampleSize:n,supportingEvidence:'NONE'});
    const html=renderHistoricalNeighbors(result); expect(html).toContain(`${n} / ${n} kazandı`); expect(html).toContain('Yetersiz örnek'); expect(html).not.toContain('100%');expect(html).not.toContain('%100');
  });
  it.each([[3,'INSUFFICIENT_DATA'],[5,'MODERATE_EVIDENCE'],[10,'STRONG_EVIDENCE']] as const)('%i same-league samples classify %s',(n,status)=>{
    expect(historicalNeighbors(target,samples(n)).status).toBe(status);
    expect(historicalNeighbors(target,samples(n).map(r=>({...r,homeScore:0,awayScore:0}))).status).toBe(status);
  });
  it.each(['marketType','marketName','selection','line'] as const)('rejects incompatible %s',key=>{
    const c=row('x'); c.route={...c.route,[key]:key==='line'?3.5:'different'};
    expect(scoreNeighbor(target,c)).toBeNull();expect(historicalNeighbors(target,[c]).sampleSize).toBe(0);
  });
  it('scores closer odds higher and keeps the deterministic breakdown bounded',()=>{
    const close=row('a'),far=row('b');far.route={...far.route,openingOdds:2.4,latestOdds:2.4};
    expect(scoreNeighbor(target,close)!.similarityScore).toBeGreaterThan(scoreNeighbor(target,far)!.similarityScore);
    for(const c of [close,far]) { const s=scoreNeighbor(target,c)!;expect(s.similarityScore).toBeGreaterThanOrEqual(0);expect(s.similarityScore).toBeLessThanOrEqual(100);
      expect(Object.values(s.breakdown).reduce<number>((sum,n)=>sum+(n??0),0)).toBeCloseTo(s.similarityScore,2); }
  });
  it('keeps cross-league neighbors visible and downgrades excessive reliance',()=>{
    const mixed=[...samples(2),...samples(8,'other').map(r=>({...r,matchId:'cross'+r.matchId,country:'Other'}))];
    const result=historicalNeighbors(target,mixed);
    expect(result).toMatchObject({sameLeagueCount:2,crossLeagueCount:8,status:'WEAK_EVIDENCE',sampleSize:10});
    expect(scoreNeighbor(target,mixed[0]!)!.similarityScore).toBeGreaterThan(scoreNeighbor(target,mixed[2]!)!.similarityScore);
    expect(result.neighbors).toHaveLength(10);
  });
  it('does not fabricate missing metadata or count low quality as usable',()=>{
    const c=row('missing','');const s=scoreNeighbor(target,c)!;expect(s.sameLeague).toBeNull();expect(s.breakdown.league).toBeNull();expect(s.unavailableComponents).toContain('league');
    const low=samples(10).map(r=>({...r,route:{...r.route,openingOdds:20,latestOdds:20,openingFairProbability:0.01,latestFairProbability:0.01}}));
    expect(historicalNeighbors(target,low)).toMatchObject({usableSampleSize:0,status:'WEAK_EVIDENCE',weightedWinRate:null,lowQualityCount:10});
    expect(renderHistoricalNeighbors(historicalNeighbors(target,low))).toContain('benzerlik kalitesi çok düşük');
  });
  it('preserves raw denominators, computes similarity weights and excludes unavailable results',()=>{
    const win=row('win'),loss={...row('loss'),homeScore:0,awayScore:0};loss.route={...loss.route,openingOdds:2.1,latestOdds:2.1};
    const result=historicalNeighbors(target,[win,loss,{...row('missing'),homeScore:null}]);
    expect(result).toMatchObject({sampleSize:3,settledSampleSize:2,wins:1,losses:1,rawWinRate:50,usableSampleSize:2,unavailableOutcomeCount:1});
    expect(result.weightedWinRate).toBeCloseTo(100/(100+94)*100,2);
  });
  it('keeps no data and unsupported settlement unavailable rather than zero percent',()=>{
    expect(historicalNeighbors(target,[])).toMatchObject({rawWinRate:null,weightedWinRate:null,status:'INSUFFICIENT_DATA'});
    const c=row('quarter');c.route={...c.route,line:2.25};
    expect(historicalNeighbors({...target,route:{...target.route,line:2.25}},[c])).toMatchObject({rawWinRate:null,unavailableOutcomeCount:1});
    expect(renderHistoricalNeighbors(null)).toContain('0 kullanılabilir / 0 ham örnek');
  });
  it('selects distinct earlier matches and exposes all score components without authority',()=>{
    const result=buildOddsIntelligence(target,[row('a'),row('a'),{...row('future'),kickoffAt:new Date('2031-01-01')}],{mode:'CLOSEST_NEIGHBORS',limit:20});
    expect(result.historicalNeighbors.sampleSize).toBe(1);expect(result.pastTwins[0]).toMatchObject({similarityScore:100,quality:'HIGH'});
    expect(result.conflictCheck.find(c=>c.source==='ODDS_TWINS')?.state).toBe('UNAVAILABLE');expect(result.executionAuthority).toBe(false);
  });
  it('serves the additive API contract and escaped inspector with visible sample counts',async()=>{
    const analysis=buildOddsIntelligence(target,[{...row('x'),homeTeam:'<script>x</script>'}],{mode:'CLOSEST_NEIGHBORS',limit:20});
    const config=loadConfig({DATABASE_URL:'postgresql://localhost/test',LOG_LEVEL:'silent'});
    const app=buildApp(config,{} as never,createLogger(config),undefined,undefined,{byMatch:async()=>analysis} as never);
    try {const response=await app.inject('/api/odds-intelligence/target');expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({historicalNeighbors:{status:'INSUFFICIENT_DATA',wins:1,rawWinRate:100},executionAuthority:false});
      const html=renderHistoricalNeighbors(analysis.historicalNeighbors);expect(html).toContain('1 kullanılabilir / 1 ham örnek');expect(html).toContain('Market: 30 / 30');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>x');
    }finally{await app.close();}
  });
  it('restores Wilson-based legacy quality without imposing a width of one',()=>{
    const analysis=buildOddsIntelligence(target,samples(50),{mode:'CLOSEST_NEIGHBORS',limit:50});
    const gaps=Array.from({length:37},()=>({wilson:{lower:0.4,upper:0.6},sampleSize:50}));
    expect(calculateEvidenceStrength(analysis.pastTwins,gaps,50)).toBe('HIGH');
    expect(calculateEvidenceStrength(analysis.pastTwins,gaps.map(g=>({...g,wilson:{lower:0,upper:1}})),50)).toBe('LOW');
  });

});
