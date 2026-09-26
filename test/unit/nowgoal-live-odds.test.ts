import { afterEach,describe,expect,it,vi } from 'vitest';
import { parseNowgoalLiveOdds,NowgoalLiveOddsProvider } from '../../src/providers/nowgoal-live-odds.js';

function sampleRow(minute:string,home:string,away:string):string{
  const row=Array.from({length:40},()=> '');
  row[0]=minute;row[1]=home;row[2]=away;
  for(const offset of [3,6,9,12])row.splice(offset,3,'0.95','0','0.85');
  for(const offset of [15,18,21,24])row.splice(offset,3,'0.85','1','0.95');
  for(const offset of [27,30,33,36])row.splice(offset,3,'3.25','2.20','3.10');
  row[39]='3';return row.join(',');
}
function payload(rows:string[],books:[string,string][]= [['8','Bet365']]){
  return {ErrCode:0,Data:books.map(([id,name])=>'2993801,'+id+','+name+'#'+rows.join('^')).join('!')};
}
const metadata={sourceUrl:'https://live11.nowgoal26.com/match/live-2993801',capturedAt:new Date('2026-01-01T00:00:00Z')};

describe('Nowgoal live odds structured parser',()=>{
  it('normalizes FT and HT Asian handicap, 1X2 and O/U markets including lines',()=>{
    const parsed=parseNowgoalLiveOdds(payload([sampleRow('45','0','0')]),metadata);
    expect(parsed).toHaveLength(2);
    const ht=parsed.find((row)=>row.period==='HT')!;const ft=parsed.find((row)=>row.period==='FT')!;
    expect(ht).toMatchObject({matchMinute:'45',minuteLabel:'45',scoreHome:0,scoreAway:0,bookmaker:'Bet365',
      ahInitialHome:0.95,ahInitialLine:0,ahInitialAway:0.85,oneXTwoInitialHome:3.25,oneXTwoInitialDraw:2.2,
      oneXTwoInitialAway:3.1,ouInitialOver:0.85,ouInitialLine:1,ouInitialUnder:0.95});
    expect(ft).toMatchObject({ahLiveHome:0.95,ahLiveLine:0,ahLiveAway:0.85,oneXTwoLiveHome:3.25,
      oneXTwoLiveDraw:2.2,oneXTwoLiveAway:3.1,ouLiveOver:0.85,ouLiveLine:1,ouLiveUnder:0.95});
    expect(ht.rawHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('keeps every history line, score, period and real source bookmaker separate',()=>{
    const parsed=parseNowgoalLiveOdds(payload([
      sampleRow('45','0','0'),sampleRow('50','0','0'),sampleRow('62','1','0'),sampleRow('87','2','0'),sampleRow('93','2','1'),
    ],[['8','Bet365'],['22','Pinnacle']]),metadata);
    expect(parsed).toHaveLength(20);
    expect(new Set(parsed.map((row)=>row.bookmaker))).toEqual(new Set(['Bet365','Pinnacle']));
    expect(new Set(parsed.map((row)=>row.period))).toEqual(new Set(['FT','HT']));
    expect(new Set(parsed.filter((row)=>row.period==='FT').map((row)=>row.matchMinute))).toEqual(new Set(['45','50','62','87','93']));
    expect(parsed.find((row)=>row.period==='FT'&&row.matchMinute==='93')).toMatchObject({scoreHome:2,scoreAway:1});
  });
  it('tracks line movement and returns null instead of inventing missing odds',()=>{
    const row=sampleRow('62','1','0').split(',');row[12]='0.98';row[13]='0.25';row[14]='0.83';row[36]='3.4';
    row[21]='';row[22]='';row[23]='';
    const parsed=parseNowgoalLiveOdds(payload([row.join(',')]),metadata);
    expect(parsed.find((item)=>item.period==='FT')).toMatchObject({ahLiveHome:0.98,ahLiveLine:0.25,ahLiveAway:0.83,oneXTwoLiveHome:3.4});
    expect(parsed.find((item)=>item.period==='FT')?.ouInitialOver).toBeNull();
  });
  it('uses the source rows as stable duplicate identities and rejects malformed/no-data input',()=>{
    const row=sampleRow('45','0','0');
    const parsed=parseNowgoalLiveOdds(payload([row,row]),metadata);
    expect(parsed[0]?.rawHash).toBe(parsed[2]?.rawHash);
    expect(parseNowgoalLiveOdds('<html>blocked</html>',metadata)).toEqual([]);
    expect(parseNowgoalLiveOdds({ErrCode:1,Data:'no data'},metadata)).toEqual([]);
    expect(parseNowgoalLiveOdds({ErrCode:0,Data:'malformed'},metadata)).toEqual([]);
  });
  it('does not guess bookmaker names when source metadata is empty',()=>{
    const parsed=parseNowgoalLiveOdds(payload([sampleRow('45','0','0')],[['8','']]),metadata);
    expect(parsed[0]?.bookmaker).toBeNull();
  });
  it('bounds stored raw payload while hashing the complete source row',()=>{
    const row=sampleRow('45','0','0').split(',');row[0]='x'.repeat(50_000);
    const parsed=parseNowgoalLiveOdds(payload([row.join(',')]),metadata);
    expect(parsed[0]?.rawPayload).toMatchObject({truncated:true,originalBytes:expect.any(Number),payloadSha256:expect.any(String)});
    expect(parsed[0]?.rawHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Nowgoal live HTTP behavior',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  const provider=(retries=0)=>new NowgoalLiveOddsProvider({NOWGOAL_LIVE_BASE_URL:'https://live11.nowgoal26.com/match/live-',
    NOWGOAL_LIVE_SMOKE_MATCH_ID:'2993801',PROVIDER_TIMEOUT_MS:1000,PROVIDER_REQUESTS_PER_SECOND:10,PROVIDER_MAX_RETRIES:retries},{warn:()=>{}} as never);
  it.each([403,429])('surfaces source block HTTP %s without retrying indefinitely',async(status)=>{
    const fetch=vi.fn().mockResolvedValue(new Response('blocked',{status}));vi.stubGlobal('fetch',fetch);
    await expect(provider().getHistory('2993801')).rejects.toThrow('HTTP '+status);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('surfaces request timeouts without fake data',async()=>{
    const fetch=vi.fn().mockRejectedValue(new DOMException('aborted','AbortError'));vi.stubGlobal('fetch',fetch);
    await expect(provider().getHistory('2993801')).rejects.toThrow();
  });
  it('retries transient failures with a bounded attempt count then parses the response',async()=>{
    const body=JSON.stringify(payload([sampleRow('62','1','0')]));
    const fetch=vi.fn().mockResolvedValueOnce(new Response('temporarily unavailable',{status:503}))
      .mockResolvedValueOnce(new Response(body,{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetch);
    const result=await provider(1).getHistory('2993801');
    expect(fetch).toHaveBeenCalledTimes(2);expect(result.observations).toHaveLength(2);
  });
  it('distinguishes an empty successful response from an invalid source body',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ErrCode:0,Data:''}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ErrCode:1,Data:'blocked'}),{status:200}));
    vi.stubGlobal('fetch',fetch);
    await expect(provider().getHistory('2993801')).resolves.toMatchObject({observations:[]});
    await expect(provider().getHistory('2993801')).rejects.toThrow('Invalid Nowgoal live odds source response');
  });
});
