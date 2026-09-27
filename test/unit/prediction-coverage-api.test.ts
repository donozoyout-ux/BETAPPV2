import {describe,expect,it,vi} from 'vitest';
import {aggregatePredictionCoverage,PredictionCoverageService} from '../../src/data/prediction-coverage.js';
import type {PredictionCoverageGroupRow,PredictionCoverageSummaryRow,PredictionCoverageTargetRow} from '../../src/data/prediction-coverage.js';

const summary:PredictionCoverageSummaryRow={total_matches:900,settled_matches:700,upcoming_matches:42,cancelled_postponed:12,
  earliest:'2024-07-01T00:00:00.000Z',latest:'2027-06-30T00:00:00.000Z'};
const groups:PredictionCoverageGroupRow[]=[
  {scope:'COMPETITION',label:'League A',settled_matches:400,matches_with_odds:310},
  {scope:'SEASON',label:'2025/26',settled_matches:500,matches_with_odds:400},
];
function target(index:number,sample:number,overrides:Partial<PredictionCoverageTargetRow>={}):PredictionCoverageTargetRow{
  return {match_id:`m-${index}`,competition:'League A',season:'2025/26',sample_count:sample,has_odds:true,complete_state:true,
    movement_available:true,fair_probability_available:true,team_metadata_complete:true,competition_metadata_complete:true,
    market_available:true,ready:sample>=30,...overrides};
}

describe('prediction coverage aggregate API',()=>{
  it('forms all sample buckets and reports 30+, 20+, 10+, and zero counts',()=>{
    const rows=[0,1,9,10,19,20,29,30,49,50,99,100,250].map((value,index)=>target(index,value));
    const result=aggregatePredictionCoverage(summary,groups,rows);
    expect(result.sampleBuckets).toEqual({zero:1,oneToNine:2,tenToNineteen:2,twentyToTwentyNine:2,
      thirtyToFortyNine:2,fiftyToNinetyNine:2,hundredPlus:2});
    expect(result.historicalCoverage).toEqual({thirtyPlus:6,twentyPlus:8,tenPlus:10,zero:1});
  });

  it('aggregates odds, readiness, competition and season coverage without exposing row identifiers',()=>{
    const rows=[target(1,35),target(2,15,{has_odds:false,ready:false}),target(3,0,{team_metadata_complete:false,ready:false})];
    const result=aggregatePredictionCoverage(summary,groups,rows);
    expect(result.oddsCoverage).toMatchObject({withOdds:2,withoutOdds:1,completeState:2,movementAvailable:2,fairProbabilityAvailable:2});
    expect(result.metadataCoverage.team).toEqual({complete:2,missing:1,total:3});
    expect(result.predictionReadiness).toEqual({ready:1,waitingForSample:0,waitingForOdds:1,waitingForMetadata:1,blockedByGate:0,noHistoricalData:0});
    expect(result.competitionCoverage[0]).toEqual({competition:'League A',settledMatches:400,matchesWithOdds:310,
      thirtyPlusSample:1,twentyPlusSample:1,zeroSample:1});
    expect(result.seasonCoverage[0]).toMatchObject({season:'2025/26',settledMatches:500,matchesWithOdds:400,thirtyPlusSample:1});
    const json=JSON.stringify(result);
    expect(json).not.toContain('m-1');
    expect(json).not.toMatch(/DATABASE_URL|privateKey|rawPayload|access_token/i);
  });

  it('returns complete zero-valued aggregates for an empty database',()=>{
    const emptySummary:PredictionCoverageSummaryRow={total_matches:0,settled_matches:0,upcoming_matches:0,cancelled_postponed:0,
      earliest:null,latest:null};
    const result=aggregatePredictionCoverage(emptySummary,[],[]);
    expect(result.totalMatches).toBe(0);
    expect(result.sampleBuckets.zero).toBe(0);
    expect(result.historicalCoverage).toEqual({thirtyPlus:0,twentyPlus:0,tenPlus:0,zero:0});
    expect(result.oddsCoverage).toMatchObject({withOdds:0,withoutOdds:0});
    expect(result.dateRange).toEqual({earliest:null,latest:null});
  });

  it('keeps missing optional metadata visible and accounts for odds-free targets',()=>{
    const result=aggregatePredictionCoverage(summary,[],[target(1,0,{has_odds:false,team_metadata_complete:false,
      competition_metadata_complete:false,market_available:false,complete_state:false,movement_available:false,
      fair_probability_available:false,ready:false})]);
    expect(result.metadataCoverage).toEqual({team:{complete:0,missing:1,total:1},
      competition:{complete:0,missing:1,total:1},market:{available:0,missing:1,total:1}});
    expect(result.predictionReadiness.waitingForOdds).toBe(1);
  });

  it('queries historical candidates with the strict earlier-than cutoff and makes no writes',async()=>{
    const statements:string[]=[];
    const pool={query:vi.fn(async(sql:string)=>{
      statements.push(sql);
      if(sql.includes('WITH targets AS'))return {rows:[]} as never;
      if(sql.includes('GROUP BY m.season'))return {rows:[]} as never;
      if(sql.includes('SELECT name FROM leagues'))return {rows:[{name:'Premier League'}]} as never;
      return {rows:[summary]} as never;
    })};
    const service=new PredictionCoverageService(pool as never,['PremierLeague']);
    await service.get(new Date('2026-09-27T12:00:00Z'));
    const targetSql=statements.find(sql=>sql.includes('WITH targets AS'))!;
    expect(targetSql).toContain('e.kickoff_at<i.kickoff_at');
    expect(targetSql).toContain('e.competition_id IN(SELECT id FROM leagues WHERE name=ANY($25::text[]))');
    expect(targetSql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(statements).toHaveLength(4);
  });
});
