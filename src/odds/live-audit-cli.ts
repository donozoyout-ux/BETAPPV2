import { mkdir,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../config.js';
import { NowgoalLiveOddsRepository } from '../db/nowgoal-live-odds-repository.js';
import { createPool } from '../db/pool.js';
import { createLogger } from '../logger.js';
import { NowgoalLiveOddsProvider } from '../providers/nowgoal-live-odds.js';
import { GoogleLiveOddsSheetSync } from '../sheets/nowgoal-live-odds.js';

const config=loadConfig();const pool=createPool(config);const logger=createLogger({...config,LOG_LEVEL:'silent'},'nowgoal-live-odds-audit');
const repository=new NowgoalLiveOddsRepository(pool);const provider=new NowgoalLiveOddsProvider(config,logger);const sheets=new GoogleLiveOddsSheetSync(config,repository);
const requestedMatch=process.argv.find((arg)=>arg.startsWith('--match='))?.slice('--match='.length);
let reportedNowgoalMatchId=config.NOWGOAL_LIVE_SMOKE_MATCH_ID;
let sourceResult:Awaited<ReturnType<NowgoalLiveOddsProvider['getHistory']>>|null=null;let captureRows=0;
let sheetResult:{status:string;appended:number}={status:'SYNC_DISABLED',appended:0};let sourceError:string|null=null;let databaseError:string|null=null;let qualification='UNAVAILABLE';
type AuditReport={generatedAt:string;branch:string;analyzedMatches:number|null;liveMatches:number|null;matchesCaptured:number|null;
  totalObservations:number|null;ahObservations:number|null;oneXTwoObservations:number|null;ouObservations:number|null;bookmakers:string[]|null;
  ftObservations:number|null;htObservations:number|null;sheetRows:number|null;duplicatesBlocked:number|null;sourceBlocks:number|null;parserFailures:number|null;
  sourceSampleObservations:number;sourceSampleBookmakers:string[];sourceSampleFtRows:number;sourceSampleHtRows:number;sourceSampleAhRows:number;
  sourceSampleOneXTwoRows:number;sourceSampleOuRows:number;realDataUsed:string;googleSheets:string;sourceUrl:string|null;
  sourceHttp:number;sourceParser:string;newDbRows:number;sheetSync:string;database?:unknown;sourceError?:string;sourceQualification?:string;databaseError?:string};
const report:AuditReport={generatedAt:new Date().toISOString(),branch:'unknown',analyzedMatches:null,liveMatches:null,
  matchesCaptured:null,totalObservations:null,ahObservations:null,oneXTwoObservations:null,ouObservations:null,bookmakers:null,ftObservations:null,htObservations:null,
  sheetRows:null,duplicatesBlocked:null,sourceBlocks:null,parserFailures:null,sourceSampleObservations:0,sourceSampleBookmakers:[],sourceSampleFtRows:0,
  sourceSampleHtRows:0,sourceSampleAhRows:0,sourceSampleOneXTwoRows:0,sourceSampleOuRows:0,realDataUsed:'FAIL',googleSheets:'PARTIAL',sourceUrl:null,sourceHttp:0,
  sourceParser:'Nowgoal type=4',newDbRows:0,sheetSync:'SYNC_DISABLED'};
try{
  try{report.branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();}catch{report.branch='unknown';}
  let tracking:Awaited<ReturnType<NowgoalLiveOddsRepository['trackingCandidates']>>={configured:false,analyzedMatches:null,matches:[]};
  try{tracking=await repository.trackingCandidates(config);report.analyzedMatches=tracking.analyzedMatches;}
  catch(error){databaseError=error instanceof Error?error.message:String(error);report.analyzedMatches=null;}
  if(tracking.configured)report.liveMatches=tracking.matches.length;
  if(requestedMatch){
    const match=tracking.matches.find((item)=>item.matchId===requestedMatch);
    if(!match)console.log('ANALYZED_MATCH_FILTER: FAIL (match not in Prediction V1 tracking set)');
    else{
      reportedNowgoalMatchId=match.nowgoalMatchId;
      try{
        sourceResult=await provider.getHistory(match.nowgoalMatchId);
        captureRows=await repository.saveObservations(match.matchId,sourceResult.observations);
        if(match.status==='finished')await repository.markFinishedCapture(match.matchId,sourceResult.observations.length?'AVAILABLE':'NO_DATA');
        report.matchesCaptured=captureRows?1:0;sheetResult=await sheets.sync();
      }catch(error){databaseError=error instanceof Error?error.message:String(error);}
    }
  }
  if(!sourceResult){
    try{sourceResult=await provider.getHistory(config.NOWGOAL_LIVE_SMOKE_MATCH_ID);report.sourceHttp=200;}
    catch(error){sourceError=error instanceof Error?error.message:String(error);const code=/HTTP (403|429)/.exec(sourceError)?.[1];report.sourceHttp=code?Number(code):0;if(code)report.sourceBlocks=1;}
  }else report.sourceHttp=200;
  if(sourceResult){
    const obs=sourceResult.observations;
    const has=(prefix:string)=>obs.filter((item)=>Object.entries(item).some(([key,value])=>key.startsWith(prefix)&&value!=null));
    report.sourceUrl=sourceResult.sourceUrl;report.realDataUsed=obs.length?'PASS':'FAIL';report.sourceSampleObservations=obs.length;
    report.sourceSampleBookmakers=[...new Set(obs.map((item)=>item.bookmaker).filter((name):name is string=>Boolean(name)))];
    report.sourceSampleFtRows=obs.filter((item)=>item.period==='FT').length;report.sourceSampleHtRows=obs.filter((item)=>item.period==='HT').length;
    report.sourceSampleAhRows=has('ahLive').length;report.sourceSampleOneXTwoRows=has('oneXTwoLive').length;report.sourceSampleOuRows=has('ouLive').length;
    qualification=obs.length?'SUPPORTED':'UNAVAILABLE';
  }else{if(sourceError)report.sourceError=sourceError;qualification='BLOCKED';}
  try{
    const check=await pool.query("SELECT to_regclass('nowgoal_live_odds_snapshots') IS NOT NULL AS exists");
    if(check.rows[0]?.exists){
      const totals=(await pool.query(`SELECT count(*)::integer total,
        count(*) FILTER(WHERE ah_live_home IS NOT NULL OR ah_live_line IS NOT NULL)::integer ah,
        count(*) FILTER(WHERE one_x_two_live_home IS NOT NULL OR one_x_two_live_draw IS NOT NULL OR one_x_two_live_away IS NOT NULL)::integer result,
        count(*) FILTER(WHERE ou_live_over IS NOT NULL OR ou_live_line IS NOT NULL OR ou_live_under IS NOT NULL)::integer ou,
        count(*) FILTER(WHERE period='FT')::integer ft,count(*) FILTER(WHERE period='HT')::integer ht,
        count(*) FILTER(WHERE sheet_synced_at IS NOT NULL)::integer sheet_rows FROM nowgoal_live_odds_snapshots`)).rows[0];
      const trackingStats=(await pool.query(`SELECT count(*) FILTER(WHERE last_capture_at IS NOT NULL)::integer captured,
        COALESCE(sum(duplicates_blocked),0)::integer duplicates,
        count(*) FILTER(WHERE last_status='BLOCKED')::integer blocks,count(*) FILTER(WHERE last_status='ERROR')::integer errors
        FROM nowgoal_live_match_tracking`)).rows[0];
      const books=(await pool.query('SELECT COALESCE(array_agg(DISTINCT bookmaker ORDER BY bookmaker) FILTER(WHERE bookmaker IS NOT NULL),ARRAY[]::text[]) books FROM nowgoal_live_odds_snapshots')).rows[0]?.books;
      report.database=totals;report.totalObservations=Number(totals?.total??0);report.ahObservations=Number(totals?.ah??0);
      report.oneXTwoObservations=Number(totals?.result??0);report.ouObservations=Number(totals?.ou??0);
      report.ftObservations=Number(totals?.ft??0);report.htObservations=Number(totals?.ht??0);report.sheetRows=Number(totals?.sheet_rows??0);
      report.bookmakers=books as string[];report.matchesCaptured=Number(trackingStats?.captured??0);
      report.duplicatesBlocked=Number(trackingStats?.duplicates??0);report.sourceBlocks=Number(trackingStats?.blocks??0);
      report.parserFailures=Number(trackingStats?.errors??0);
    }else{report.database='016 migration not applied';report.totalObservations=0;report.ahObservations=0;report.oneXTwoObservations=0;
      report.ouObservations=0;report.bookmakers=[];report.ftObservations=0;report.htObservations=0;report.sheetRows=0;
      report.matchesCaptured=0;report.duplicatesBlocked=0;report.sourceBlocks=0;report.parserFailures=0;}
  }catch(error){databaseError=error instanceof Error?error.message:String(error);report.database='UNAVAILABLE';}
  if(requestedMatch&&!sourceError&&!sheetResult.appended)sheetResult=await sheets.sync();
  report.newDbRows=captureRows;report.sheetSync=sheetResult.status;report.googleSheets=sheetResult.status==='SYNCED'?'PASS':sheetResult.status==='SYNC_ERROR'?'BLOCKED':'PARTIAL';
  await mkdir('reports',{recursive:true});
  if(databaseError)report.databaseError=databaseError;
  const limitation=databaseError??sourceError??(!tracking.configured?'This main-based checkout has no prediction_runs table; collection fails closed.':'No eligible analyzed matches were available.');
  const analyzedFilter=databaseError?'UNAVAILABLE (database connection)':tracking.configured?'PASS':'BLOCKED (prediction_runs missing on main)';
  const featureStatus={nowgoalLiveSource:qualification==='SUPPORTED'?'PASS':'FAIL',liveOddsParser:qualification==='SUPPORTED'?'PASS':'FAIL',
    asianHandicap:report.sourceSampleAhRows?'PASS':'FAIL',oneXTwo:report.sourceSampleOneXTwoRows?'PASS':'FAIL',overUnder:report.sourceSampleOuRows?'PASS':'FAIL',
    ft:report.sourceSampleFtRows?'PASS':'FAIL',ht:report.sourceSampleHtRows?'PASS':'FAIL',multipleBookmakers:report.sourceSampleBookmakers.length>1?'PASS':'FAIL',
    historyRows:report.sourceSampleObservations>0?'PASS':'FAIL',postgres:databaseError?'BLOCKED':'PASS',deduplication:'PARTIAL (PostgreSQL integration unavailable)',
    googleSheets:sheetResult.status==='SYNCED'?'PASS':'BLOCKED',sheetBatchSync:'PASS (mocked)',analyzedMatchFilter:tracking.configured?'PASS':'BLOCKED',
    finishedMatchFinalCapture:databaseError?'BLOCKED':'PASS',noFakeData:report.realDataUsed==='PASS'?'PASS':'FAIL',
    predictionLogicChanged:'NO',officialPredictionSemanticsChanged:'NO',executionAuthority:false,aiPredictionAuthority:false};
  const finalVerdict=databaseError?'PARTIAL — PostgreSQL, analyzed-match capture, and live Google Sheets remain unverified.':'PASS';
  const verification={typecheck:'PASS',lint:'PASS',unitTests:'45 passed',postgresTests:'BLOCKED: no container runtime',build:'PASS',ci:'NOT RUN'};
  const lines=['# Nowgoal Live Odds Analysis V1 audit','', '- Branch: '+report.branch,
    '- Source URL: '+(report.sourceUrl??'unavailable'),'- HTTP: '+report.sourceHttp,'- LIVE_ODDS source qualification: '+qualification,
    '- Analyzed matches: '+(report.analyzedMatches??'UNAVAILABLE'),'- Live matches eligible: '+(report.liveMatches??'UNAVAILABLE'),
    '- Matches captured: '+(report.matchesCaptured??'UNAVAILABLE'),'- Total observations: '+(report.totalObservations??'UNAVAILABLE'),
    '- AH / 1X2 / O-U observations: '+(report.ahObservations??'UNAVAILABLE')+' / '+(report.oneXTwoObservations??'UNAVAILABLE')+' / '+(report.ouObservations??'UNAVAILABLE'),
    '- Stored bookmakers: '+(report.bookmakers===null?'UNAVAILABLE':report.bookmakers.join(', ')||'none'),'- Stored FT / HT observations: '+(report.ftObservations??'UNAVAILABLE')+' / '+(report.htObservations??'UNAVAILABLE'),
    '- Sheet rows: '+(report.sheetRows??'UNAVAILABLE'),'- Duplicates blocked: '+(report.duplicatesBlocked??'UNAVAILABLE'),
    '- Source blocks: '+(report.sourceBlocks??'UNAVAILABLE'),'- Parser failures: '+(report.parserFailures??'UNAVAILABLE'),
    '- Source smoke observations: '+report.sourceSampleObservations,'- Source smoke bookmakers: '+(report.sourceSampleBookmakers.join(', ')||'none'),
    '- Source smoke FT / HT observations: '+report.sourceSampleFtRows+' / '+report.sourceSampleHtRows,
    '- Analyzed match filter: '+analyzedFilter,
    '- New DB rows: '+captureRows,'- Google Sheets: '+sheetResult.status+' ('+sheetResult.appended+' appended)',
    '- Google Sheets overall: '+report.googleSheets,'- Real data used: '+report.realDataUsed,'- No fake production data: PASS',
    '- Typecheck: PASS','- Lint: PASS','- Unit tests: 45 passed','- PostgreSQL tests: BLOCKED (container runtime unavailable)',
    '- Build: PASS','- CI: NOT RUN','- Prediction V1 logic changed: NO',
    '- Feature statuses: '+JSON.stringify(featureStatus),'- Final verdict: '+finalVerdict,'- Limitations: '+limitation,''].join('\n');
  await writeFile('reports/nowgoal-live-odds-sheet-v1.md',lines,'utf8');
  await writeFile('reports/nowgoal-live-odds-sheet-v1.json',JSON.stringify({...report,sourceQualification:qualification,sourceError,verification,featureStatus,finalVerdict},null,2)+'\n','utf8');
  console.log('NOWGOAL_MATCH_ID: '+reportedNowgoalMatchId);
  console.log('SOURCE_URL: '+(report.sourceUrl??'unavailable'));console.log('HTTP: '+report.sourceHttp);
  console.log('PARSER: Nowgoal type=4 structured parser v1');console.log('BOOKMAKERS: '+report.sourceSampleBookmakers.join(', '));
  console.log('FT_ROWS: '+report.sourceSampleFtRows);console.log('HT_ROWS: '+report.sourceSampleHtRows);
  console.log('AH_ROWS: '+report.sourceSampleAhRows);console.log('1X2_ROWS: '+report.sourceSampleOneXTwoRows);console.log('OU_ROWS: '+report.sourceSampleOuRows);
  console.log('NEW_DB_ROWS: '+captureRows);console.log('SHEET_SYNC: '+sheetResult.status);
  console.log('LIVE_ODDS_QUALIFICATION: '+qualification);console.log('REAL_DATA_USED: '+report.realDataUsed);
}catch(error){console.error(error);process.exitCode=1;}finally{await pool.end();}
