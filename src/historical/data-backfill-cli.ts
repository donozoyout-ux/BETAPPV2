import { mkdir, writeFile } from 'node:fs/promises';
import { dryRunHistoricalBackfill, initialBackfillCompetitions, plannedBackfillSources } from './data-backfill-dry-run.js';

const argumentsMap=new Map(process.argv.slice(2).filter(value=>value.startsWith('--')).map(value=>{
  const [key,...rest]=value.slice(2).split('=');return [key!,rest.join('=')||'true'];
}));
const competition=argumentsMap.get('competition')??'all';
if(argumentsMap.get('dry-run')!=='true')throw new Error('This command only supports --dry-run=true; it never writes to the database.');
const seasonValues=(argumentsMap.get('seasons')??'2024-25,2025-26').split(',').map(value=>value.trim()).filter(Boolean);
const baseUrl=process.env.OPENFOOTBALL_BASE_URL??'https://raw.githubusercontent.com/openfootball/football.json/master';
const selected=competition.toLowerCase()==='all'?initialBackfillCompetitions.map(item=>item.configKey):[competition];
const results=[];
for(const key of selected)results.push(await dryRunHistoricalBackfill({competitionKey:key,baseUrl,seasons:seasonValues}));
const report={version:'HISTORICAL_DATA_BACKFILL_V1',mode:'DRY_RUN',databaseWrites:0,generatedAt:new Date().toISOString(),
  sources:plannedBackfillSources(baseUrl,seasonValues,selected),competitions:results,
  statisticsCoverage:{importedByMatchSource:0,note:'OpenFootball match-results source contains no match statistics.'},
  oddsCoverage:{officialTimestampedOddsImported:0,shadowExamplesImported:0,
    note:'Football-Data archived opening/closing columns have no trusted capture timestamp; official historical odds are not imported.'},
  officialHistoricalExamples:{generated:0,note:'Dry-run does not mutate/refresh prediction examples.'},
  shadowExamples:{generated:0,note:'Existing shadow CSV layer is unchanged by dry-run.'},
  secondPhaseAssessment:{imported:false,competitions:[
    {competition:'Eredivisie',configSupported:true,openFootballSourceAvailable:true},
    {competition:'Belgian Pro League',configSupported:true,openFootballSourceAvailable:true},
    {competition:'Portuguese league',configSupported:false,openFootballSourceAvailable:false},
    {competition:'Scottish league',configSupported:false,openFootballSourceAvailable:false},
    {competition:'Brasileirão Série A',configSupported:true,openFootballSourceAvailable:false},
  ]},
  lookahead:{status:'PASS_BY_SOURCE_DESIGN',rule:'historical_kickoff < target_kickoff',
    importedHistoricalMatchesHaveExplicitKickoff:true,noOddsImported:true},
  note:'Duplicate estimate requires read-only comparison against the target database; no production database was queried.'};
await mkdir('reports',{recursive:true});
await writeFile('reports/historical-data-backfill-v1.json',JSON.stringify(report,null,2)+'\n','utf8');
const markdown=`# Historical Data Backfill V1 — Dry Run

Generated: ${report.generatedAt}

- Mode: DRY_RUN
- Database writes: 0
- Duplicate estimate: unknown (no production DB query)
- Historical cutoff: historical kickoff < target kickoff
- Odds: none imported; timestamp-free archive odds remain shadow only

${results.map(result=>`## ${result.competition}

- Target: ${result.targetFinishedMatches} finished matches
- Discovered: ${result.discovered}
- Inserted: ${result.inserted}
- Imported: ${result.imported}
- Import eligible (explicit kickoff + FT): ${result.eligible}
- Duplicate: unknown; source identity check requires DB
- Unsafe timestamp: ${result.unsafe_time}
- Missing FT: ${result.skipped}
- Invalid result: ${result.invalid_result}
- Errors: ${result.errors}

| Season | Discovered | Eligible | Inserted | Imported | Unsafe time | Missing FT | Invalid result | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${result.seasons.map(row=>`| ${row.season} | ${row.discovered} | ${row.eligible} | ${row.inserted} | ${row.imported} | ${row.unsafe_time} | ${row.skipped} | ${row.invalid_result} | ${row.errors} |`).join('\n')}
`).join('\n')}
`;
await writeFile('reports/historical-data-backfill-v1.md',markdown,'utf8');
console.log(JSON.stringify(report,null,2));
