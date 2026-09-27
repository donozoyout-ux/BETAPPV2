import { mkdir, writeFile } from 'node:fs/promises';
import { dryRunHistoricalBackfill, initialBackfillCompetitions, plannedBackfillSources } from './data-backfill-dry-run.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { reconcileHistoricalBackfill } from './reconciliation.js';
import { enforceReconciliationOnlyMode, productionDatabaseUnavailable } from './backfill-command-policy.js';

const argumentsMap=new Map(process.argv.slice(2).filter(value=>value.startsWith('--')).map(value=>{
  const [key,...rest]=value.slice(2).split('=');return [key!,rest.join('=')||'true'];
}));
const competition=argumentsMap.get('competition')??'all';
const execute=argumentsMap.get('execute')==='true';
enforceReconciliationOnlyMode({dryRun:argumentsMap.get('dry-run')==='true',execute,
  dataBackfillEnabled:process.env.DATA_BACKFILL_ENABLED==='true'});
const reconcileRequested=argumentsMap.get('reconcile-production')==='true';
const seasonValues=(argumentsMap.get('seasons')??'2024-25,2025-26,2026-27').split(',').map(value=>value.trim()).filter(Boolean);
const baseUrl=process.env.OPENFOOTBALL_BASE_URL??'https://raw.githubusercontent.com/openfootball/football.json/master';
const selected=competition.toLowerCase()==='all'?initialBackfillCompetitions.map(item=>item.configKey):[competition];
const results=[];
for(const key of selected)results.push(await dryRunHistoricalBackfill({competitionKey:key,baseUrl,seasons:seasonValues}));

let reconciliation:Record<string,unknown>|null=null;
if(reconcileRequested){
  if(!process.env.DATABASE_URL?.trim()||process.env.NODE_ENV!=='production')
    reconciliation=productionDatabaseUnavailable(results);
  else{
    let pool:ReturnType<typeof createPool>|null=null;
    try{
      pool=createPool(loadConfig());
      reconciliation=await reconcileHistoricalBackfill(pool,results);
    }catch{
      reconciliation=productionDatabaseUnavailable(results);
    }finally{await pool?.end();}
  }
}
const safeCompetitions=results.map(({seasons,...result})=>({...result,seasons:seasons.map(season=>
  Object.fromEntries(Object.entries(season).filter(([key])=>key!=='eligibleMatches')))}));
const report={version:'HISTORICAL_DATA_RECONCILIATION_V1',mode:reconcileRequested?'RECONCILIATION_ONLY':'DRY_RUN',
  generatedAt:new Date().toISOString(),productionReconciliation:reconciliation,
  sourceSummary:{source_candidates:results.reduce((s,r)=>s+r.discovered,0),eligible:results.reduce((s,r)=>s+r.eligible,0),
    inserted:0,imported:0},competitions:safeCompetitions,
  sources:plannedBackfillSources(baseUrl,seasonValues,selected),
  statisticsCoverage:{importedByMatchSource:0,note:'OpenFootball match-results source contains no match statistics.'},
  oddsCoverage:{officialTimestampedOddsImported:0,shadowExamplesImported:0,
    note:'Football-Data archive opening/closing values have no trusted capture timestamp; no odds are imported.'},
  officialHistoricalExamples:{generated:0,note:'Reconciliation does not mutate or refresh prediction examples.'},
  shadowExamples:{generated:0,note:'Existing shadow CSV layer is unchanged.'},
  lookahead:{status:'PASS_BY_SOURCE_DESIGN',rule:'historical_kickoff_at < target_kickoff_at',
    sourceCutoff:'2024-01-01T00:00:00.000Z',futureMatchesExcluded:true,noOddsImported:true},
  safetyChecks:{productionImportExecuted:false,insertUpdateDelete:0,readOnlyReconciliation:reconcileRequested,
    dataBackfillEnabledRequiredForExecute:true,executeFlagRequiredForExecute:true,maxBatchMatches:150}};

await mkdir('reports',{recursive:true});
await writeFile('reports/historical-data-backfill-v1.json',JSON.stringify(report,null,2)+'\n','utf8');
const reconciliationMarkdown=reconciliation?`# Historical Backfill Reconciliation V1\n\nStatus: ${reconciliation.status}\n\nProduction DB query is read-only. Import writes: 0.\n\n| Competition | Source candidates | Eligible | Existing duplicate | New insertable | Ambiguous | Invalid |\n|---|---:|---:|---:|---:|---:|---:|\n${(reconciliation.competition_summary as Array<Record<string,unknown>>).map(row=>`| ${row.competition} | ${row.source_candidates} | ${row.eligible} | ${row.existing_duplicate??'unknown'} | ${row.new_insertable??'unknown'} | ${row.ambiguous??'unknown'} | ${row.invalid} |`).join('\n')}\n\n`+
  (reconciliation.status==='PRODUCTION_DB_UNAVAILABLE'?'`PRODUCTION_DB_UNAVAILABLE`: production DATABASE_URL with NODE_ENV=production was unavailable or the read-only connection failed. No duplicate or insertable counts were inferred.':'')+
  `\nSafety: INSERT/UPDATE/DELETE=0; odds and prediction tables untouched.\n`:'';
const backfillMarkdown=`# Historical Data Backfill V1 — Reconciliation Source Scan\n\nGenerated: ${report.generatedAt}\n\nMode: ${report.mode}\nProduction import: not executed.\nDuplicate reconciliation: ${reconciliation?.status??'NOT_REQUESTED'}\nLookahead cutoff: 2024-01-01; future matches excluded.\n\n${results.map(result=>`## ${result.competition}\n\n- Source candidates: ${result.discovered}\n- Eligible (explicit kickoff + FT, past cutoff): ${result.eligible}\n- Inserted: 0\n- Imported: 0\n- Unsafe timestamp: ${result.unsafe_time}\n- Future: ${result.future}\n- Before cutoff: ${result.before_cutoff}\n- Missing FT: ${result.skipped}\n- Invalid result: ${result.invalid_result}\n- Source errors: ${result.errors}\n- Existing duplicates/new insertable: ${reconciliation?.status==='RECONCILED'?'see reconciliation report':'unknown'}\n`).join('\n')}`;
await writeFile('reports/historical-data-backfill-v1.md',backfillMarkdown,'utf8');
if(reconcileRequested){
  await writeFile('reports/historical-data-reconciliation-v1.json',JSON.stringify(report,null,2)+'\n','utf8');
  await writeFile('reports/historical-data-reconciliation-v1.md',reconciliationMarkdown,'utf8');
}
console.log(JSON.stringify(report,null,2));
if(reconciliation?.status==='PRODUCTION_DB_UNAVAILABLE')process.exitCode=2;
