import { sign } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { NowgoalLiveOddsRepository } from '../db/nowgoal-live-odds-repository.js';

const TAB='Live_Odds_Analysis';
export const LIVE_ODDS_SHEET_HEADER=['match_id','nowgoal_match_id','source_url','captured_at','match_minute','minute_label','score','period','bookmaker',
  'ah_initial_home','ah_initial_line','ah_initial_away','ah_live_home','ah_live_line','ah_live_away',
  'one_x_two_initial_home','one_x_two_initial_draw','one_x_two_initial_away','one_x_two_live_home','one_x_two_live_draw','one_x_two_live_away',
  'ou_initial_over','ou_initial_line','ou_initial_under','ou_live_over','ou_live_line','ou_live_under','parser_version','raw_hash','observation_identity'];
const HEADER=LIVE_ODDS_SHEET_HEADER;
const range=(a1:string)=>encodeURIComponent("'"+TAB+"'!")+a1.replace(':','%3A');
type SheetResult={status:'SYNCED'|'SYNC_DISABLED'|'SYNC_ERROR';appended:number;error?:string};
type SheetApiResponse={sheets?:Array<{properties:{title:string;sheetId:number}}>};
export type GoogleSheetsSmokeStatus='GOOGLE_SHEETS_CONNECTED'|'GOOGLE_SHEETS_NOT_CONFIGURED'|'GOOGLE_SHEETS_PERMISSION_ERROR'
  |'GOOGLE_SHEETS_AUTH_ERROR'|'GOOGLE_SHEETS_API_ERROR';
export type GoogleSheetsSmokeResult={status:GoogleSheetsSmokeStatus;error?:string};
function dateSerial(value:unknown):number|null { const date=new Date(String(value)); return Number.isNaN(date.getTime())?null:date.getTime()/86_400_000+25_569; }
function identity(row:Record<string,unknown>):string {
  return [row.match_id,row.nowgoal_match_id,row.match_minute??'',row.score_home??'',row.score_away??'',row.period,row.bookmaker??'',row.raw_hash].join('|');
}
function rowValues(row:Record<string,unknown>) {
  const odds=[row.ah_initial_home,row.ah_initial_line,row.ah_initial_away,row.ah_live_home,row.ah_live_line,row.ah_live_away,
    row.one_x_two_initial_home,row.one_x_two_initial_draw,row.one_x_two_initial_away,row.one_x_two_live_home,row.one_x_two_live_draw,row.one_x_two_live_away,
    row.ou_initial_over,row.ou_initial_line,row.ou_initial_under,row.ou_live_over,row.ou_live_line,row.ou_live_under]
    .map((value)=>value==null?'':Number(value));
  return [row.match_id,row.nowgoal_match_id,row.source_url,dateSerial(row.captured_at),row.match_minute,row.minute_label,
    row.score_text??(row.score_home==null||row.score_away==null?'':String(row.score_home)+':'+String(row.score_away)),row.period,row.bookmaker,
    ...odds,row.parser_version,row.raw_hash,identity(row)];
}
export class GoogleLiveOddsSheetSync {
  private token:{value:string;expires:number}|null=null;
  constructor(private readonly config:AppConfig,private readonly repository?:NowgoalLiveOddsRepository) {}
  async smoke():Promise<GoogleSheetsSmokeResult>{
    const id=this.config.GOOGLE_SHEETS_SPREADSHEET_ID;
    const email=this.config.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
    const key=this.config.GOOGLE_SHEETS_PRIVATE_KEY;
    if(!id||!email||!key)return {status:'GOOGLE_SHEETS_NOT_CONFIGURED'};
    let token:string;
    try { token=await this.accessToken(email,key); }
    catch(error) {
      const message=error instanceof Error?error.message:'';
      if(/Google token exchange HTTP 5\d\d\b/.test(message)||/fetch failed|network|timed out/i.test(message))
        return {status:'GOOGLE_SHEETS_API_ERROR',error:'Google token service could not be reached.'};
      return {status:'GOOGLE_SHEETS_AUTH_ERROR',error:'Google service-account authentication failed.'};
    }
    const headers={'authorization':'Bearer '+token,'content-type':'application/json'};
    const root='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);
    try {
      let metadata=await this.request(root+'?fields=sheets.properties',{headers});
      let sheet=metadata.sheets?.find((item)=>item.properties.title===TAB);
      if(!sheet){
        await this.request(root+':batchUpdate',{method:'POST',headers,body:JSON.stringify({requests:[{addSheet:{properties:{title:TAB}}}]})});
        metadata=await this.request(root+'?fields=sheets.properties',{headers});
        sheet=metadata.sheets?.find((item)=>item.properties.title===TAB);
      }
      if(!sheet)throw new Error('Google Sheets tab could not be created or resolved.');
      const existing=await this.request(root+'/values/'+range('A:AD'),{headers}) as SheetApiResponse & {values?:unknown[][]};
      const rows=existing.values??[];
      if(!rows.length||!rows[0]?.length){
        await this.request(root+'/values/'+range('A1')+'?valueInputOption=RAW',{method:'PUT',headers,body:JSON.stringify({values:[HEADER]})});
      }else if(JSON.stringify(rows[0])!==JSON.stringify(HEADER)){
        return {status:'GOOGLE_SHEETS_API_ERROR',error:'Live_Odds_Analysis header does not match the expected schema.'};
      }
      return {status:'GOOGLE_SHEETS_CONNECTED'};
    }catch(error){
      const message=error instanceof Error?error.message:'';
      if(/Google Sheets HTTP 403\b/.test(message))return {status:'GOOGLE_SHEETS_PERMISSION_ERROR',error:'Google service account cannot access this spreadsheet.'};
      if(/Google Sheets HTTP 401\b/.test(message))return {status:'GOOGLE_SHEETS_AUTH_ERROR',error:'Google rejected the service-account authorization.'};
      return {status:'GOOGLE_SHEETS_API_ERROR',error:'Google Sheets API connection or setup failed.'};
    }
  }
  async inspect(appendRealRows = false): Promise<SheetResult & {wouldAppend?:number;configured:boolean}> {
    const id=this.config.GOOGLE_SHEETS_SPREADSHEET_ID,email=this.config.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,key=this.config.GOOGLE_SHEETS_PRIVATE_KEY;
    if(!id||!email||!key)return {status:'SYNC_DISABLED',appended:0,configured:false};
    try {
      const headers={'authorization':'Bearer '+await this.accessToken(email,key),'content-type':'application/json'};
      const root='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);
      const meta=await this.request(root+'?fields=sheets.properties',{headers});
      let sheet=meta.sheets?.find((item)=>item.properties.title===TAB);
      if(!sheet){await this.request(root+':batchUpdate',{method:'POST',headers,body:JSON.stringify({requests:[{addSheet:{properties:{title:TAB}}}]})});
        const refreshed=await this.request(root+'?fields=sheets.properties',{headers});sheet=refreshed.sheets?.find((item)=>item.properties.title===TAB);}
      if(!sheet)throw new Error('Unable to create or resolve Live_Odds_Analysis tab');
      const encoded=range('A:AD');
      const existing=await this.request(root+'/values/'+encoded,{headers}) as SheetApiResponse & {values?:unknown[][]};
      const rows=existing.values??[];
      if(!rows.length||!rows[0]?.length)await this.request(root+'/values/'+range('A1')+'?valueInputOption=RAW',{method:'PUT',headers,body:JSON.stringify({values:[HEADER]})});
      else if(JSON.stringify(rows[0])!==JSON.stringify(HEADER))throw new Error('Existing Live_Odds_Analysis headers do not match expected schema');
      const known=new Set(rows.slice(1).map((row)=>String(row[29]??'')));
      if(!this.repository)throw new Error('Live odds repository is required for inspect.');
      const pending=await this.repository.unsynced(5000);
      const toAppend=pending.filter((row)=>!known.has(identity(row)));
      if(appendRealRows&&toAppend.length)await this.request(root+'/values/'+encoded+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{
        method:'POST',headers,body:JSON.stringify({values:toAppend.map(rowValues)})});
      if(appendRealRows&&pending.length)await this.repository.markSheetSynced(pending.map((row)=>String(row.id)));
      return {status:'SYNCED',appended:appendRealRows?toAppend.length:0,wouldAppend:toAppend.length,configured:true};
    }catch(error){return {status:'SYNC_ERROR',appended:0,configured:true,error:error instanceof Error?error.message:String(error)};}
  }
  async sync():Promise<SheetResult> {
    const id=this.config.GOOGLE_SHEETS_SPREADSHEET_ID,email=this.config.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,key=this.config.GOOGLE_SHEETS_PRIVATE_KEY;
    if(!id||!email||!key)return {status:'SYNC_DISABLED',appended:0};
    try {
      if(!this.repository)throw new Error('Live odds repository is required for sync.');
      const pending=await this.repository.unsynced();
      if(!pending.length)return {status:'SYNCED',appended:0};
      const headers={'authorization':'Bearer '+await this.accessToken(email,key),'content-type':'application/json'};
      const root='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id);
      const meta=await this.request(root+'?fields=sheets.properties',{headers});
      let sheet=meta.sheets?.find((item)=>item.properties.title===TAB);
      if(!sheet){
        await this.request(root+':batchUpdate',{method:'POST',headers,body:JSON.stringify({requests:[{addSheet:{properties:{title:TAB}}}]})});
        const refreshed=await this.request(root+'?fields=sheets.properties',{headers});
        sheet=refreshed.sheets?.find((item)=>item.properties.title===TAB);
      }
      if(!sheet)throw new Error('Unable to create or resolve Live_Odds_Analysis tab');
      const encoded=range('A:AD');
      const existing=await this.request(root+'/values/'+encoded,{headers}) as SheetApiResponse & {values?:unknown[][]};
      const existingRows=(existing.values??[]) as unknown[][];
      const known=new Set(existingRows.slice(1).map((row)=>String(row[29]??'')));
      const toAppend=pending.filter((row)=>!known.has(identity(row)));
      if(!existingRows.length||!existingRows[0]?.length){
        await this.request(root+'/values/'+range('A1')+'?valueInputOption=RAW',{method:'PUT',headers,body:JSON.stringify({values:[HEADER]})});
      } else if(JSON.stringify(existingRows[0])!==JSON.stringify(HEADER)) {
        throw new Error('Existing Live_Odds_Analysis headers do not match expected schema');
      }
      await this.request(root+':batchUpdate',{method:'POST',headers,body:JSON.stringify({requests:[
        {updateSheetProperties:{properties:{sheetId:sheet.properties.sheetId,gridProperties:{frozenRowCount:1}},fields:'gridProperties.frozenRowCount'}},
        {setBasicFilter:{filter:{range:{sheetId:sheet.properties.sheetId,startRowIndex:0,startColumnIndex:0,endColumnIndex:HEADER.length}}}},
        {repeatCell:{range:{sheetId:sheet.properties.sheetId,startRowIndex:0,endRowIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true},wrapStrategy:'WRAP'}},fields:'userEnteredFormat(textFormat,wrapStrategy)'}},
        {repeatCell:{range:{sheetId:sheet.properties.sheetId,startRowIndex:1,startColumnIndex:3,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'DATE_TIME',pattern:'yyyy-mm-dd hh:mm:ss'}}},fields:'userEnteredFormat.numberFormat'}},
      ]})});
      if(toAppend.length)await this.request(root+'/values/'+encoded+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{
        method:'POST',headers,body:JSON.stringify({values:toAppend.map(rowValues)})});
      await this.repository.markSheetSynced(pending.map((row)=>String(row.id)));
      return {status:'SYNCED',appended:toAppend.length};
    }catch(error){return {status:'SYNC_ERROR',appended:0,error:error instanceof Error?error.message:String(error)};}
  }
  private async accessToken(email:string,privateKey:string):Promise<string>{
    if(this.token&&this.token.expires>Date.now()+60_000)return this.token.value;
    const now=Math.floor(Date.now()/1000);const enc=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const header=enc({alg:'RS256',typ:'JWT'});const claim=enc({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const unsigned=header+'.'+claim;const pem=privateKey.replace(/\\n/g,'\n');
    const jwt=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),pem).toString('base64url');
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});
    if(!response.ok)throw new Error('Google token exchange HTTP '+response.status);
    const data=await response.json() as {access_token:string;expires_in:number};this.token={value:data.access_token,expires:Date.now()+data.expires_in*1000};return data.access_token;
  }
  private async request(url:string,init:RequestInit):Promise<SheetApiResponse>{
    let error:unknown;
    for(let attempt=0;attempt<3;attempt++){
      try{const response=await fetch(url,{...init,signal:AbortSignal.timeout(15_000)});if(response.ok)return response.status===204?{}:response.json();
        const body=(await response.text()).slice(0,500);if(response.status<500&&response.status!==429)throw new Error('Google Sheets HTTP '+response.status+': '+body);
        error=new Error('Google Sheets HTTP '+response.status+': '+body);
      }catch(caught){error=caught;}
      if(error instanceof Error&&/^Google Sheets HTTP [1-4](?!29)/.test(error.message))throw error;
      if(attempt<2)await new Promise((resolve)=>setTimeout(resolve,250*2**attempt+Math.random()*200));
    }
    throw error instanceof Error?error:new Error(String(error));
  }
}
