import {generateKeyPairSync} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {AppConfig} from '../../src/config.js';
import {GoogleLiveOddsSheetSync} from '../../src/sheets/nowgoal-live-odds.js';

function row(index:number){
  return {id:'id-'+index,match_id:'match-'+index,nowgoal_match_id:String(1000+index),source_url:'https://live11.nowgoal26.com/match/live-'+(1000+index),
    captured_at:new Date('2026-01-01T00:00:00Z'),match_minute:'45',minute_label:'45',score_home:0,score_away:0,score_text:'0:0',period:'FT',bookmaker:'Bet365',
    ah_initial_home:'0.95',ah_initial_line:'0',ah_initial_away:'0.85',ah_live_home:'0.98',ah_live_line:'0',ah_live_away:'0.83',
    one_x_two_initial_home:'3.25',one_x_two_initial_draw:'2.2',one_x_two_initial_away:'3.1',one_x_two_live_home:'3.25',
    one_x_two_live_draw:'2.3',one_x_two_live_away:'3',ou_initial_over:'0.85',ou_initial_line:'1',ou_initial_under:'0.95',
    ou_live_over:'0.73',ou_live_line:'1',ou_live_under:'1.08',parser_version:'1',raw_hash:'hash-'+index};
}
const identity=(item:ReturnType<typeof row>)=>[item.match_id,item.nowgoal_match_id,item.match_minute,item.score_home,item.score_away,item.period,item.bookmaker,item.raw_hash].join('|');
function setup(options:{configured?:boolean;count?:number}={}){
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const config={GOOGLE_SHEETS_SPREADSHEET_ID:options.configured===false?undefined:'sheet-id',
    GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL:options.configured===false?undefined:'bot@example.com',GOOGLE_SHEETS_PRIVATE_KEY:privateKey.replace(/\n/g,'\\n')} as unknown as AppConfig;
  const repository={unsynced:vi.fn().mockResolvedValue(Array.from({length:options.count??10},(_,index)=>row(index))),
    markSheetSynced:vi.fn().mockResolvedValue(undefined)};
  return {sync:new GoogleLiveOddsSheetSync(config,repository as never),repository};
}

describe('Google live odds sheet mirror',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('disables sync without credentials and does not call Google',async()=>{
    const {sync}=setup({configured:false});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect(await sync.sync()).toMatchObject({status:'SYNC_DISABLED',appended:0});expect(fetch).not.toHaveBeenCalled();
  });
  it('creates the tab and headers then batch appends 10 rows in one request',async()=>{
    const {sync,repository}=setup();let metadataCalls=0;let appendCalls=0;let headerWrites=0;let appendedRows:unknown[][]=[];
    const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes('oauth2.googleapis.com/token'))return new Response(JSON.stringify({access_token:'token',expires_in:3600}),{status:200});
      if(url.includes('?fields=sheets.properties')){metadataCalls++;return new Response(JSON.stringify({sheets:metadataCalls===1?[]:[{properties:{title:'Live_Odds_Analysis',sheetId:6}}]}),{status:200});}
      if(url.includes(':batchUpdate'))return new Response('{}',{status:200});
      if(url.includes('AD:AD'))return new Response(JSON.stringify({}),{status:200});
      if(url.includes('A1?')){headerWrites++;return new Response('{}',{status:200});}
      if(url.includes(':append')){appendCalls++;appendedRows=(JSON.parse(String(init?.body)).values as unknown[][]);return new Response('{}',{status:200});}
      throw new Error('Unexpected URL '+url);
    });
    vi.stubGlobal('fetch',fetch);
    expect(await sync.sync()).toMatchObject({status:'SYNCED',appended:10});
    expect(metadataCalls).toBe(2);expect(headerWrites).toBe(1);expect(appendCalls).toBe(1);expect(appendedRows).toHaveLength(10);
    expect(appendedRows[0]).toHaveLength(30);expect(typeof appendedRows[0]?.[9]).toBe('number');expect(repository.markSheetSynced).toHaveBeenCalledWith(Array.from({length:10},(_,i)=>'id-'+i));
  });
  it('skips identities already present in the sheet and retains numeric odds',async()=>{
    const {sync,repository}=setup();let appendedRows:unknown[][]=[];
    const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes('oauth2.googleapis.com/token'))return new Response(JSON.stringify({access_token:'token',expires_in:3600}),{status:200});
      if(url.includes('?fields=sheets.properties'))return new Response(JSON.stringify({sheets:[{properties:{title:'Live_Odds_Analysis',sheetId:1}}]}),{status:200});
      if(url.includes('AD:AD'))return new Response(JSON.stringify({values:[['observation_identity'],[identity(row(0))]]}),{status:200});
      if(url.includes(':batchUpdate'))return new Response('{}',{status:200});
      if(url.includes(':append')){appendedRows=JSON.parse(String(init?.body)).values as unknown[][];return new Response('{}',{status:200});}
      throw new Error('Unexpected URL '+url);
    });vi.stubGlobal('fetch',fetch);
    expect(await sync.sync()).toMatchObject({status:'SYNCED',appended:9});
    expect(appendedRows).toHaveLength(9);expect(repository.markSheetSynced).toHaveBeenCalledTimes(1);
    expect(appendedRows[0]?.[3]).toEqual(expect.any(Number));expect(appendedRows[0]?.[9]).toBe(0.95);
  });
  it('reports Google API failures without marking DB rows synced',async()=>{
    const {sync,repository}=setup({count:1});
    const fetch=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes('oauth2.googleapis.com/token'))return new Response(JSON.stringify({access_token:'token',expires_in:3600}),{status:200});
      if(url.includes('?fields=sheets.properties'))return new Response(JSON.stringify({sheets:[{properties:{title:'Live_Odds_Analysis',sheetId:1}}]}),{status:200});
      if(url.includes('AD:AD'))return new Response(JSON.stringify({values:[['observation_identity']]}),{status:200});
      if(url.includes(':batchUpdate'))return new Response('{}',{status:200});
      if(url.includes(':append'))return new Response('temporarily unavailable',{status:503});
      throw new Error('Unexpected URL '+url);
    });vi.stubGlobal('fetch',fetch);
    expect(await sync.sync()).toMatchObject({status:'SYNC_ERROR',appended:0});
    expect(fetch.mock.calls.filter(([url])=>String(url).includes(':append'))).toHaveLength(3);
    expect(repository.markSheetSynced).not.toHaveBeenCalled();
  });
  it('reports invalid service-account credentials as a sync error',async()=>{
    const {sync,repository}=setup({count:1});
    const fetch=vi.fn().mockResolvedValue(new Response('invalid credentials',{status:401}));vi.stubGlobal('fetch',fetch);
    expect(await sync.sync()).toMatchObject({status:'SYNC_ERROR'});
    expect(repository.markSheetSynced).not.toHaveBeenCalled();
  });
});
