import { describe, expect, it } from 'vitest';
import { parseCsv, parseFootballDataDataset, localKickoffToUtc } from '../../src/historical/public-csv-parser.js';
import { currentFootballDataSeasonCode, publicCsvDatasets, seasonLabel } from '../../src/historical/public-csv-source.js';

describe('public CSV historical import', () => {
  it('builds only configured Football-Data season URLs', () => {
    const rows=publicCsvDatasets('https://football-data.co.uk',['2526','2425'],['Eredivisie','SuperLig']);
    expect(rows).toHaveLength(4);
    expect(rows.find((row)=>row.configKey==='Eredivisie' && row.seasonCode==='2526')?.url)
      .toBe('https://football-data.co.uk/mmz4281/2526/N1.csv');
    expect(rows.find((row)=>row.configKey==='SuperLig' && row.seasonCode==='2425')?.url)
      .toBe('https://football-data.co.uk/mmz4281/2425/T1.csv');
    expect(seasonLabel('2526')).toBe('2025/2026');
    expect(currentFootballDataSeasonCode(new Date('2026-09-24T12:00:00Z'))).toBe('2627');
    expect(currentFootballDataSeasonCode(new Date('2027-03-01T12:00:00Z'))).toBe('2627');
  });

  it('parses quoted CSV fields and real match/stat/odds columns without market-average pseudo bookmakers', () => {
    const csv=[
      'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,Referee,HS,AS,HST,AST,HC,AC,HF,AF,HY,AY,HR,AR,B365H,B365D,B365A,B365CH,B365CD,B365CA,AvgH,AvgD,AvgA,B365>2.5,B365<2.5,B365C>2.5,B365C<2.5,AHh,B365AHH,B365AHA,AHCh,B365CAHH,B365CAHA',
      'N1,16/08/25,20:00,"Ajax, AFC",PSV,2,1,Ref Name,14,9,6,3,7,4,10,13,2,3,0,0,2.1,3.5,3.2,2.0,3.6,3.4,2.05,3.55,3.3,1.9,1.95,1.85,2.0,-0.5,2.0,1.85,-0.75,2.05,1.82',
    ].join('\n');
    expect(parseCsv(csv)[0]?.HomeTeam).toBe('Ajax, AFC');
    const dataset=publicCsvDatasets('https://football-data.co.uk',['2526'],['Eredivisie'])[0]!;
    const parsed=parseFootballDataDataset(csv,dataset,new Date('2026-09-24T12:00:00Z'));
    expect(parsed).toHaveLength(1);
    const item=parsed[0]!;
    expect(item.match).toMatchObject({status:'finished',season:'2025/2026',homeScore:2,awayScore:1});
    expect(item.match.kickoffAt.toISOString()).toBe('2025-08-16T18:00:00.000Z');
    expect(item.statistics.statistics.find((stat)=>stat.key==='corners')).toMatchObject({homeValue:7,awayValue:4});
    expect(item.statistics.statistics.find((stat)=>stat.key==='shots_on_target')).toMatchObject({homeValue:6,awayValue:3});
    expect(item.refereeExternalId).toBe('football-data:Ref Name');
    expect(item.odds.some((odd)=>odd.bookmaker==='bet365' && odd.marketType==='MATCH_RESULT'
      && odd.selection==='HOME' && odd.observationStage==='PRE_CLOSING')).toBe(true);
    expect(item.odds.some((odd)=>odd.bookmaker==='bet365' && odd.marketType==='MATCH_RESULT'
      && odd.selection==='HOME' && odd.observationStage==='CLOSING')).toBe(true);
    expect(item.odds.some((odd)=>odd.marketType==='TOTAL_GOALS' && odd.line===2.5 && odd.selection==='OVER')).toBe(true);
    expect(item.odds.some((odd)=>odd.marketType==='ASIAN_HANDICAP' && odd.line===-0.75
      && odd.observationStage==='CLOSING')).toBe(true);
    expect(item.odds.some((odd)=>odd.bookmaker==='avg')).toBe(false);
  });

  it('converts local kickoff time with real timezone rules instead of a fixed offset', () => {
    expect(localKickoffToUtc('16/08/25','20:00','Europe/Amsterdam')?.toISOString())
      .toBe('2025-08-16T18:00:00.000Z');
    expect(localKickoffToUtc('16/08/25','20:00','Europe/Istanbul')?.toISOString())
      .toBe('2025-08-16T17:00:00.000Z');
  });

  it('drops unfinished or malformed rows rather than manufacturing results', () => {
    const csv='Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG\nN1,16/08/25,20:00,Ajax,PSV,,';
    const dataset=publicCsvDatasets('https://football-data.co.uk',['2526'],['Eredivisie'])[0]!;
    expect(parseFootballDataDataset(csv,dataset)).toEqual([]);
  });
});
