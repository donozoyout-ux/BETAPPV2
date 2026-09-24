import { describe,it,expect } from 'vitest';
import { calibrationReport,percentile,shadowCoverage,describeScores,summarizeTargets,insufficientReasons } from '../../src/odds-neighbors/calibration.js';
import { neighborReliabilityConfig,historicalNeighbors } from '../../src/odds-neighbors/reliability.js';
import { buildOddsRoute } from '../../src/odds-neighbors/features.js';
import { decodeCalibrationRows,calibrationRowsSql } from '../../src/odds-neighbors/calibration-source.js';
import type { HistoricalNeighborInput } from '../../src/odds-neighbors/types.js';
const date='2026-09-24T00:00:00Z';
function record(i:number):HistoricalNeighborInput {
 const kickoff=new Date(Date.UTC(2025,0,i+2));const id=String(i);
 const route=buildOddsRoute(id,kickoff,['OVER','UNDER'].map(selection=>({matchId:id,provider:'test',marketType:'TOTAL_GOALS',marketName:'Total Goals',selection,line:2.5,oddsDecimal:2,capturedAt:new Date(Date.UTC(2025,0,i+1))})),'TOTAL_GOALS','Total Goals',2.5,'OVER',kickoff)!;
 return {matchId:id,competitionId:'league',league:'League',country:null,homeTeam:'A',awayTeam:'B',kickoffAt:kickoff,homeScore:2,awayScore:1,firstHalfHomeScore:null,firstHalfAwayScore:null,homeCorners:null,awayCorners:null,homeYellowCards:null,awayYellowCards:null,homeRedCards:null,awayRedCards:null,route};
}
describe('read-only neighbor calibration',()=>{
 it('uses interpolated percentiles and null for empty populations',()=>{expect(percentile([],0.5)).toBeNull();expect(percentile([0,10,20,30],0.5)).toBe(15);expect(percentile([0,10,20,30],0.9)).toBeCloseTo(27);});
 it('bins every similarity exactly once including boundaries',()=>{const d=describeScores([0,49.9,50,60,70,80,85,90,95,100]);expect(Object.values(d.bins).reduce((s,n)=>s+n.count,0)).toBe(10);});
 it('sums all target sample/status bins',()=>{const summaries=[0,1,2,3,5,10,20].map(n=>shadowCoverage(Array.from({length:n},()=>({similarityScore:100,sameLeague:true,settled:true,unavailableComponents:[]}))));const d=summarizeTargets(summaries);expect(Object.values(d.sampleDistribution).reduce((s,n)=>s+n.count,0)).toBe(7);expect(Object.values(d.statusDistribution).reduce((s,n)=>s+n.count,0)).toBe(7);});
 it('identifies cap censoring, preserves runtime constants and produces deterministic shadow reports',()=>{
  const records=Array.from({length:25},(_,i)=>record(i)),before=JSON.stringify(neighborReliabilityConfig);
  const report=calibrationReport(records,{syntheticUnitTestOnly:true},date);
  expect(report.capReached).toBe(5);expect(report.summary.targets).toBe(25);expect(report.safety.parityFailures).toBe(0);expect(report.safety.leakageViolations).toBe(0);
  expect(Object.keys(report.capSensitivity)).toEqual(['20','50','100']);expect(JSON.stringify(neighborReliabilityConfig)).toBe(before);
  expect(calibrationReport(records,{syntheticUnitTestOnly:true},date)).toEqual(report);
 });
 it('classifies missing-history, unavailable outcomes and poor-context causes',()=>{
  const target=record(2),candidate=record(1);
  expect(insufficientReasons(shadowCoverage([]),{earlier:0,market:0,line:0,selection:0},[])).toContain('NO_HISTORICAL_MATCH');
  const missing=historicalNeighbors(target,[{...candidate,homeScore:null}]);
  const cov=shadowCoverage(missing.neighbors.map(n=>({...n,settled:false})));
  expect(insufficientReasons(cov,{earlier:1,market:1,line:1,selection:1},missing.neighbors)).toContain('OUTCOME_UNAVAILABLE');
  const cross=Array.from({length:10},()=>({similarityScore:80,sameLeague:false,settled:true,unavailableComponents:[]}));
  expect(shadowCoverage(cross)).toMatchObject({status:'WEAK_EVIDENCE',crossLeagueDowngraded:true});
  expect(shadowCoverage(cross.map(n=>({...n,similarityScore:50})))).toMatchObject({status:'WEAK_EVIDENCE',usableSamples:0});
 });
 it('never uses winner labels to select a threshold or recommendation',()=>{
  const records=Array.from({length:12},(_,i)=>record(i));
  const a=calibrationReport(records,{},date),b=calibrationReport(records.map(r=>({...r,homeScore:0,awayScore:0})),{},date);
  expect(a.similarityThresholdSensitivity).toEqual(b.similarityThresholdSensitivity);expect(a.sampleThresholdSensitivity).toEqual(b.sampleThresholdSensitivity);expect(a.recommendation).toBe(b.recommendation);expect(a.verdict).toBe(b.verdict);
  expect(a.safety.executionAuthority).toBe(false);expect(a.safety.aiPredictionAuthority).toBe(false);
 });
 it('reports no data as null and retains zero coverage supported markets',()=>{const report=calibrationReport([],{},date);expect(report.verdict).toBe('INSUFFICIENT_REAL_DATA');expect(report.summary.zeroUsableRate).toBeNull();expect(report.marketDistribution.BTTS?.targets).toBe(0);});
 it('excludes same-time/future candidates and has no writes in source SQL',()=>{
  const records=[record(0),{...record(1),kickoffAt:record(0).kickoffAt},record(2)];
  const report=calibrationReport(records,{},date);expect(report.targets.slice(0,2).every(t=>t.rawSamples===0)).toBe(true);
  expect(calibrationRowsSql).toContain('o.captured_at<m.kickoff_at');expect(calibrationRowsSql).not.toMatch(/INSERT|UPDATE|DELETE/);
  expect(decodeCalibrationRows([])).toMatchObject({matchesExamined:0,matchesWithRoutes:0});
 });
});
