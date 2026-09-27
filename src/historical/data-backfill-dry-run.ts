import { openFootballDatasets, type OpenFootballDataset } from './openfootball-source.js';
import { parseOpenFootballDataset } from './openfootball-parser.js';
import { footballDataLeagueSources, publicCsvDatasets } from './public-csv-source.js';

export const initialBackfillCompetitions = [
  { configKey:'PremierLeague', name:'Premier League' }, { configKey:'LaLiga', name:'La Liga' },
  { configKey:'Bundesliga', name:'Bundesliga' }, { configKey:'SerieA', name:'Serie A' },
  { configKey:'Ligue1', name:'Ligue 1' }, { configKey:'SuperLig', name:'Süper Lig' },
] as const;

export type BackfillDatasetResult = {
  source:string; competition:string; season:string; url:string; discovered:number; eligible:number; inserted:number; imported:number;
  duplicate:number|null; skipped:number; unsafe_time:number; invalid_result:number; errors:number;
  databaseDuplicateEstimate:'UNAVAILABLE_READ_ONLY_DATABASE_NOT_CONFIGURED'|'NOT_CHECKED';
};

export type BackfillCompetitionResult = {
  competition:string; targetFinishedMatches:80; discovered:number; eligible:number; inserted:number; imported:number; duplicate:number|null;
  skipped:number; unsafe_time:number; invalid_result:number; errors:number; seasons:BackfillDatasetResult[];
};

export async function dryRunHistoricalBackfill(input:{competitionKey:string;baseUrl:string;seasons:readonly string[];
  fetcher?:(url:string)=>Promise<unknown>}):Promise<BackfillCompetitionResult>{
  const competition=initialBackfillCompetitions.find(item=>item.configKey.toLowerCase()===input.competitionKey.toLowerCase());
  if(!competition)throw new Error('Choose one of PremierLeague, LaLiga, Bundesliga, SerieA, Ligue1, SuperLig');
  const datasets=openFootballDatasets(input.baseUrl,input.seasons,[competition.configKey])
    .filter(item=>item.configKey===competition.configKey);
  const fetcher=input.fetcher??(async(url:string)=>{
    const response=await fetch(url,{headers:{'user-agent':'BETAPPV2/2.0 openfootball-cc0-dry-run'},signal:AbortSignal.timeout(20_000)});
    if(!response.ok)throw new Error(`OPENFOOTBALL_HTTP_${response.status}`);
    return response.json() as Promise<unknown>;
  });
  const results:BackfillDatasetResult[]=[];
  for(const dataset of datasets){
    try{
      const payload=await fetcher(dataset.url);
      const parsed=parseOpenFootballDataset(payload,dataset);
      const root=payload&&typeof payload==='object'?payload as {matches?:unknown[]}:{};
      const total=Array.isArray(root.matches)?root.matches.length:0;
      results.push({source:'OpenFootball CC0',competition:dataset.competition,season:dataset.season,url:dataset.url,
        discovered:total,eligible:parsed.matches.length,inserted:0,imported:0,duplicate:null,skipped:parsed.skippedUnfinished,
        unsafe_time:parsed.skippedUnsafeTime,invalid_result:parsed.invalidResult,errors:0,
        databaseDuplicateEstimate:'UNAVAILABLE_READ_ONLY_DATABASE_NOT_CONFIGURED'});
    }catch{
      results.push({source:'OpenFootball CC0',competition:dataset.competition,season:dataset.season,url:dataset.url,
        discovered:0,eligible:0,inserted:0,imported:0,duplicate:null,skipped:0,unsafe_time:0,invalid_result:0,errors:1,
        databaseDuplicateEstimate:'UNAVAILABLE_READ_ONLY_DATABASE_NOT_CONFIGURED'});
    }
  }
  return aggregateCompetition(competition.name,results);
}

function aggregateCompetition(competition:string,seasons:BackfillDatasetResult[]):BackfillCompetitionResult{
  return {competition,targetFinishedMatches:80,discovered:seasons.reduce((sum,row)=>sum+row.discovered,0),
    eligible:seasons.reduce((sum,row)=>sum+row.eligible,0),inserted:0,imported:0,duplicate:null,
    skipped:seasons.reduce((sum,row)=>sum+row.skipped,0),unsafe_time:seasons.reduce((sum,row)=>sum+row.unsafe_time,0),
    invalid_result:seasons.reduce((sum,row)=>sum+row.invalid_result,0),errors:seasons.reduce((sum,row)=>sum+row.errors,0),seasons};
}

export function plannedBackfillSources(baseUrl:string,seasons:readonly string[],configured:readonly string[]){
  const openFootball=openFootballDatasets(baseUrl,seasons,configured).filter(item=>
    initialBackfillCompetitions.some(competition=>competition.configKey===item.configKey));
  const csv=publicCsvDatasets('https://football-data.co.uk',[],configured).filter(item=>
    initialBackfillCompetitions.some(competition=>competition.configKey===item.configKey));
  return {openFootball:openFootball.map((item:OpenFootballDataset)=>({competition:item.competition,season:item.season,url:item.url,
      policy:'PRODUCTION_ELIGIBLE_CC0',matchResults:true,exactOddsTimestamps:false})),
    footballDataArchive:{competitions:footballDataLeagueSources.filter(item=>initialBackfillCompetitions.some(c=>c.configKey===item.configKey))
      .map(item=>item.competition),policy:'MANUAL_REVIEW_REQUIRED',automatedCollection:false,
      odds:'SHADOW_RESEARCH_ONLY_NO_TRUSTED_CAPTURE_TIMESTAMP'},
    csvDatasetPlanRows:csv.length};
}
