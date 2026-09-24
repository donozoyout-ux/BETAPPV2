import { createHash } from 'node:crypto';
import type { MatchStatistics, NormalizedMatch } from '../domain/types.js';
import { normalizeTeamAlias } from '../matching/team-alias.js';
import type { OpenFootballDataset } from './openfootball-source.js';

type OpenFootballMatch = {
  round?: unknown; date?: unknown; time?: unknown; team1?: unknown; team2?: unknown;
  score?: { ft?: unknown; ht?: unknown };
};

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=(type:string)=>Number(parts.find((part)=>part.type===type)?.value ?? 0);
  return Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'))-date.getTime();
}

export function openFootballKickoff(dateValue: unknown, timeValue: unknown, timeZone: string): Date | null {
  const date=String(dateValue ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time=String(timeValue ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!date || !time) return null;
  const year=Number(date[1]),month=Number(date[2]),day=Number(date[3]),hour=Number(time[1]),minute=Number(time[2]);
  if (month<1||month>12||day<1||day>31||hour>23||minute>59) return null;
  const wall=Date.UTC(year,month-1,day,hour,minute,0);
  let utc=wall;
  for (let iteration=0;iteration<3;iteration+=1) utc=wall-zoneOffsetMs(new Date(utc),timeZone);
  const result=new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result;
}

function scorePair(value: unknown): [number,number] | null {
  if (!Array.isArray(value) || value.length!==2) return null;
  const home=Number(value[0]),away=Number(value[1]);
  return Number.isInteger(home)&&home>=0&&Number.isInteger(away)&&away>=0 ? [home,away] : null;
}

function seasonLabel(season: string) {
  const match=season.match(/^(\d{4})-(\d{2})$/);
  if (!match) return season;
  return `${match[1]}/${String(Number(match[1])+1)}`;
}

export type ParsedOpenFootballMatch = {
  rowNumber: number;
  match: NormalizedMatch;
  statistics: MatchStatistics;
};

export function parseOpenFootballDataset(payload: unknown, dataset: OpenFootballDataset, fetchedAt=new Date()) {
  const root=payload && typeof payload==='object' ? payload as Record<string,unknown> : {};
  const rows=Array.isArray(root.matches) ? root.matches as OpenFootballMatch[] : [];
  let skippedUnfinished=0;
  let skippedUnsafeTime=0;
  const matches: ParsedOpenFootballMatch[]=[];
  rows.forEach((row,index)=>{
    const home=String(row.team1 ?? '').trim();
    const away=String(row.team2 ?? '').trim();
    const ft=scorePair(row.score?.ft);
    if (!home || !away || !ft) { skippedUnfinished+=1; return; }
    const kickoff=openFootballKickoff(row.date,row.time,dataset.timeZone);
    if (!kickoff) { skippedUnsafeTime+=1; return; }
    const externalId='of-'+createHash('sha256').update([
      dataset.sourceKey,String(row.date),String(row.time),normalizeTeamAlias(home),normalizeTeamAlias(away)
    ].join('|')).digest('hex').slice(0,32);
    const raw={source:'openfootball/football.json',sourceKey:dataset.sourceKey,rowNumber:index+1,row};
    const match:NormalizedMatch={
      providerExternalId:externalId,
      league:{providerExternalId:`openfootball:${dataset.file}`,name:dataset.competition,country:dataset.country,
        logoUrl:null,sourceUpdatedAt:fetchedAt,raw:{source:'openfootball/football.json',file:dataset.file}},
      homeTeam:{providerExternalId:`openfootball:${dataset.country}:${normalizeTeamAlias(home)}`,name:home,shortName:null,
        country:dataset.country,logoUrl:null,sourceUpdatedAt:fetchedAt,raw:{source:'openfootball/football.json'}},
      awayTeam:{providerExternalId:`openfootball:${dataset.country}:${normalizeTeamAlias(away)}`,name:away,shortName:null,
        country:dataset.country,logoUrl:null,sourceUpdatedAt:fetchedAt,raw:{source:'openfootball/football.json'}},
      kickoffAt:kickoff,status:'finished',round:row.round==null?null:String(row.round),season:seasonLabel(dataset.season),
      homeScore:ft[0],awayScore:ft[1],sourceUpdatedAt:fetchedAt,raw,
    };
    matches.push({rowNumber:index+1,match,statistics:{matchProviderExternalId:externalId,statistics:[],sourceUpdatedAt:fetchedAt,raw}});
  });
  return {name:String(root.name ?? ''),totalMatches:rows.length,finishedRows:matches.length,skippedUnfinished,skippedUnsafeTime,matches};
}
