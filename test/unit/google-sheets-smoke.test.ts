import {generateKeyPairSync} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {loadConfig} from '../../src/config.js';
import {GoogleLiveOddsSheetSync, LIVE_ODDS_SHEET_HEADER} from '../../src/sheets/nowgoal-live-odds.js';

function createConfig(overrides:Record<string,string|undefined>={}){
  const key=overrides.GOOGLE_SHEETS_PRIVATE_KEY??generateKeyPairSync('rsa',{modulusLength:2048,
    privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
  return loadConfig({...process.env,DATABASE_URL:'postgres://localhost/betapp',GOOGLE_SHEETS_SPREADSHEET_ID:'sheet-id',
    GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL:'service@example.com',GOOGLE_SHEETS_PRIVATE_KEY:key,...overrides});
}

describe('Google Sheets real-connection smoke path',()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it('reports missing credentials without making a request',async()=>{
    const config=createConfig({GOOGLE_SHEETS_SPREADSHEET_ID:undefined,GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL:undefined,GOOGLE_SHEETS_PRIVATE_KEY:undefined});
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect(await new GoogleLiveOddsSheetSync(config).smoke()).toEqual({status:'GOOGLE_SHEETS_NOT_CONFIGURED'});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('authenticates, checks metadata and initializes a missing header without appending rows',async()=>{
    const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=new URL(String(input));
      if(url.hostname==='oauth2.googleapis.com')return new Response(JSON.stringify({access_token:'mock-access-token',expires_in:3600}),{status:200});
      if(url.searchParams.has('fields'))return new Response(JSON.stringify({sheets:[{properties:{title:'Live_Odds_Analysis',sheetId:10}}]}),{status:200});
      if(url.pathname.includes('/values/')){
        if(init?.method==='PUT'){
          expect(JSON.parse(String(init.body))).toEqual({values:[LIVE_ODDS_SHEET_HEADER]});
          return new Response('{}',{status:200});
        }
        return new Response(JSON.stringify({}),{status:200});
      }
      throw new Error('Unexpected test request');
    });vi.stubGlobal('fetch',fetch);
    const result=await new GoogleLiveOddsSheetSync(createConfig()).smoke();
    expect(result).toEqual({status:'GOOGLE_SHEETS_CONNECTED'});
    expect(fetch.mock.calls.some(([input])=>String(input).includes(':append'))).toBe(false);
    expect(fetch.mock.calls.some(([input])=>String(input).includes('/spreadsheets/sheet-id?fields=sheets.properties'))).toBe(true);
  });

  it('classifies token endpoint 401 as authentication failure without leaking secrets',async()=>{
    const secret='PRIVATE-KEY-SHOULD-NEVER-LEAK';
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'invalid_grant',error_description:secret}),{status:401}));
    vi.stubGlobal('fetch',fetch);
    const result=await new GoogleLiveOddsSheetSync(createConfig()).smoke();
    expect(result.status).toBe('GOOGLE_SHEETS_AUTH_ERROR');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('classifies a token service 5xx as an API error without leaking response details',async()=>{
    const secret='TOKEN-SERVICE-SECRET';
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:secret}),{status:503})));
    const result=await new GoogleLiveOddsSheetSync(createConfig()).smoke();
    expect(result.status).toBe('GOOGLE_SHEETS_API_ERROR');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('classifies a Sheets API 5xx as an API error without leaking response details',async()=>{
    const secret='SHEETS-API-SECRET';
    const fetch=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      if(url.hostname==='oauth2.googleapis.com')return new Response(JSON.stringify({access_token:'mock-token',expires_in:3600}),{status:200});
      return new Response(JSON.stringify({error:{message:secret}}),{status:500});
    });vi.stubGlobal('fetch',fetch);
    const result=await new GoogleLiveOddsSheetSync(createConfig()).smoke();
    expect(result.status).toBe('GOOGLE_SHEETS_API_ERROR');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('classifies Google metadata 403 as a permission error without leaking response details',async()=>{
    const secret='ACCESS-TOKEN-OR-SECRET';
    const fetch=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      if(url.hostname==='oauth2.googleapis.com')return new Response(JSON.stringify({access_token:secret,expires_in:3600}),{status:200});
      return new Response(JSON.stringify({error:{message:secret}}),{status:403});
    });vi.stubGlobal('fetch',fetch);
    const result=await new GoogleLiveOddsSheetSync(createConfig()).smoke();
    expect(result.status).toBe('GOOGLE_SHEETS_PERMISSION_ERROR');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('classifies malformed private keys as authentication failures without logging key material',async()=>{
    const secret='MALFORMED-PRIVATE-KEY-SECRET';
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const result=await new GoogleLiveOddsSheetSync(createConfig({GOOGLE_SHEETS_PRIVATE_KEY:secret})).smoke();
    expect(result.status).toBe('GOOGLE_SHEETS_AUTH_ERROR');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fetch).not.toHaveBeenCalled();
  });
});
