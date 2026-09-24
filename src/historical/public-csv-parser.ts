import { createHash } from 'node:crypto';
import type { MatchStatistics, NormalizedMatch, NormalizedStatistic } from '../domain/types.js';
import { normalizeTeamAlias } from '../matching/team-alias.js';
import type { PublicCsvDataset } from './public-csv-source.js';

export type HistoricalArchivedOdd = {
  bookmaker: string;
  marketType: string;
  marketName: string;
  line: number | null;
  selection: string;
  oddsDecimal: number;
  observationStage: 'PRE_CLOSING' | 'CLOSING';
};

export type ParsedFootballDataRow = {
  rowNumber: number;
  rowHash: string;
  match: NormalizedMatch;
  statistics: MatchStatistics;
  refereeExternalId: string | null;
  odds: HistoricalArchivedOdd[];
};

export function parseCsv(text: string): Array<Record<string,string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index=0; index<text.length; index+=1) {
    const char=text[index]!;
    if (char === '"') {
      if (quoted && text[index+1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field); field='';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index+1] === '\n') index += 1;
      row.push(field); field='';
      if (row.some((value)=>value.trim() !== '')) rows.push(row);
      row=[];
    } else field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value)=>value.trim() !== '')) rows.push(row);
  }
  const header=(rows.shift() ?? []).map((value)=>value.trim().replace(/^\uFEFF/,''));
  return rows.map((values)=>Object.fromEntries(header.map((key,index)=>[key,(values[index] ?? '').trim()])));
}

function numberValue(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed=Number(value.replace(',','.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function intValue(value: string | undefined): number | null {
  const parsed=numberValue(value);
  return parsed == null || !Number.isInteger(parsed) ? null : parsed;
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',
    hourCycle:'h23',
  }).formatToParts(date);
  const get=(type:string)=>Number(parts.find((part)=>part.type===type)?.value ?? 0);
  return Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'))-date.getTime();
}

export function localKickoffToUtc(dateValue: string, timeValue: string | undefined, timeZone: string): Date | null {
  const match=dateValue.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const day=Number(match[1]), month=Number(match[2]);
  const year=match[3]!.length===2 ? 2000+Number(match[3]) : Number(match[3]);
  const time=(timeValue ?? '12:00').trim().match(/^(\d{1,2}):(\d{2})$/);
  const hour=time ? Number(time[1]) : 12;
  const minute=time ? Number(time[2]) : 0;
  if (!Number.isInteger(day)||!Number.isInteger(month)||!Number.isInteger(year)||hour>23||minute>59) return null;
  const wall=Date.UTC(year,month-1,day,hour,minute,0);
  let utc=wall;
  for (let iteration=0; iteration<3; iteration+=1) utc=wall-zoneOffsetMs(new Date(utc),timeZone);
  const result=new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result;
}

const statPairs: Array<[string,string,string,string]> = [
  ['HS','AS','total_shots','Shots'],
  ['HST','AST','shots_on_target','Shots on Target'],
  ['HC','AC','corners','Corners'],
  ['HF','AF','fouls','Fouls'],
  ['HO','AO','offsides','Offsides'],
  ['HY','AY','yellow_cards','Yellow Cards'],
  ['HR','AR','red_cards','Red Cards'],
];

function statistics(row: Record<string,string>): NormalizedStatistic[] {
  return statPairs.flatMap(([homeKey,awayKey,key,label]) => {
    const home=numberValue(row[homeKey]);
    const away=numberValue(row[awayKey]);
    return home == null && away == null ? [] : [{key,label,period:'ALL',homeValue:home,awayValue:away}];
  });
}

function bookmakerName(raw: string): string {
  const names: Record<string,string> = {
    B365:'bet365', PS:'pinnacle', P:'pinnacle', BF:'betfair', BFE:'betfair_exchange', BW:'bwin',
    IW:'interwetten', WH:'william_hill', VC:'betvictor', BV:'betvictor', PP:'paddy_power',
    SK:'skybet', '1XB':'1xbet', BFD:'betfred', BMGM:'betmgm', GB:'gamebookers', LB:'ladbrokes',
    SB:'sportingbet', SJ:'stan_james', SO:'sporting_odds', SY:'stanleybet', CL:'coral',
  };
  return names[raw] ?? raw.toLowerCase();
}

function aggregatePrefix(prefix: string): boolean {
  return /^(avg|max|bb|bbmx|bbav)/i.test(prefix);
}

function oddsFromRow(row: Record<string,string>): HistoricalArchivedOdd[] {
  const odds: HistoricalArchivedOdd[]=[];
  const add=(bookmaker:string,marketType:string,marketName:string,line:number|null,selection:string,value:string|undefined,
    stage:'PRE_CLOSING'|'CLOSING')=>{
    const decimal=numberValue(value);
    if (decimal==null || decimal<=1) return;
    odds.push({bookmaker:bookmakerName(bookmaker),marketType,marketName,line,selection,oddsDecimal:decimal,observationStage:stage});
  };

  for (const key of Object.keys(row)) {
    if (key.includes('AH') || key.includes('>') || key.includes('<')) continue;
    const match=key.match(/^([A-Za-z0-9]+?)(C?)(H|D|A)$/);
    if (!match || aggregatePrefix(match[1]!)) continue;
    const stage=match[2] === 'C' ? 'CLOSING' : 'PRE_CLOSING';
    const selection=match[3] === 'H' ? 'HOME' : match[3] === 'D' ? 'DRAW' : 'AWAY';
    add(match[1]!, 'MATCH_RESULT','1X2',null,selection,row[key],stage);
  }

  for (const key of Object.keys(row)) {
    const match=key.match(/^([A-Za-z0-9]+?)(C?)(>|<)(\d+(?:\.\d+)?)$/);
    if (!match || aggregatePrefix(match[1]!)) continue;
    const stage=match[2] === 'C' ? 'CLOSING' : 'PRE_CLOSING';
    const selection=match[3] === '>' ? 'OVER' : 'UNDER';
    add(match[1]!, 'TOTAL_GOALS','Total Goals',Number(match[4]),selection,row[key],stage);
  }

  for (const key of Object.keys(row)) {
    const match=key.match(/^([A-Za-z0-9]+?)(C?)AH(H|A)$/);
    if (!match || aggregatePrefix(match[1]!)) continue;
    const stage=match[2] === 'C' ? 'CLOSING' : 'PRE_CLOSING';
    const line=numberValue(stage==='CLOSING' ? (row.AHCh || row.AHh) : row.AHh);
    if (line==null) continue;
    const selection=match[3] === 'H' ? 'HOME' : 'AWAY';
    add(match[1]!, 'ASIAN_HANDICAP','Asian Handicap',line,selection,row[key],stage);
  }

  const unique=new Map<string,HistoricalArchivedOdd>();
  for (const item of odds) {
    const key=JSON.stringify([item.bookmaker,item.marketType,item.marketName,item.line,item.selection,item.observationStage]);
    unique.set(key,item);
  }
  return [...unique.values()];
}

export function parseFootballDataDataset(text: string, dataset: PublicCsvDataset, fetchedAt = new Date()): ParsedFootballDataRow[] {
  return parseCsv(text).flatMap((row,rowIndex) => {
    const home=row.HomeTeam?.trim();
    const away=row.AwayTeam?.trim();
    const homeGoals=intValue(row.FTHG ?? row.HG);
    const awayGoals=intValue(row.FTAG ?? row.AG);
    const kickoff=localKickoffToUtc(row.Date ?? '',row.Time,dataset.timeZone);
    if (!home || !away || homeGoals==null || awayGoals==null || !kickoff) return [];
    const rowHash=createHash('sha256').update(JSON.stringify(row)).digest('hex');
    const externalId='fd-'+createHash('sha256')
      .update([dataset.sourceKey,row.Date,row.Time ?? '',normalizeTeamAlias(home),normalizeTeamAlias(away)].join('|'))
      .digest('hex').slice(0,32);
    const raw={source:'football-data.co.uk',sourceKey:dataset.sourceKey,rowNumber:rowIndex+2,row};
    const match: NormalizedMatch = {
      providerExternalId:externalId,
      league:{providerExternalId:`football-data:${dataset.division}`,name:dataset.competition,country:dataset.country,
        logoUrl:null,sourceUpdatedAt:fetchedAt,raw:{source:'football-data.co.uk',division:dataset.division}},
      homeTeam:{providerExternalId:`football-data:${dataset.country}:${normalizeTeamAlias(home)}`,name:home,shortName:null,
        country:dataset.country,logoUrl:null,sourceUpdatedAt:fetchedAt,raw:{source:'football-data.co.uk'}},
      awayTeam:{providerExternalId:`football-data:${dataset.country}:${normalizeTeamAlias(away)}`,name:away,shortName:null,
        country:dataset.country,logoUrl:null,sourceUpdatedAt:fetchedAt,raw:{source:'football-data.co.uk'}},
      kickoffAt:kickoff,status:'finished',round:null,season:dataset.seasonLabel,
      homeScore:homeGoals,awayScore:awayGoals,sourceUpdatedAt:fetchedAt,raw,
    };
    const stats: MatchStatistics = {matchProviderExternalId:externalId,statistics:statistics(row),sourceUpdatedAt:fetchedAt,raw};
    const referee=row.Referee?.trim() ? `football-data:${row.Referee.trim()}` : null;
    return [{rowNumber:rowIndex+2,rowHash,match,statistics:stats,refereeExternalId:referee,odds:oddsFromRow(row)}];
  });
}
