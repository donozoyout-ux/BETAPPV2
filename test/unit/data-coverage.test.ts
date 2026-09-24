import { describe, expect, it, vi } from 'vitest';
import { coverageRows, DataCoverageService } from '../../src/data/coverage.js';
import { coverageAuditChecks } from '../../src/data/coverage-audit.js';
import { dataPoolCard } from '../../src/data/coverage-view.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { blankReport } from '../../src/historical/competition-scope.js';
import { DATA_TARGET_V1, enrichCoverageTargets } from '../../src/data/coverage-target.js';
const rows = [{ competition:'Eredivisie', matches:5, finished_matches:4, stats:3, odds:2, odds_three:1, odds_snapshots:18,
  csv_odds:3, csv_odds_three:2, csv_odds_quotes:42,
  csv_stage_matches:2, csv_stage_examples:12, csv_stage_research_eligible:9,
  upcoming_matches:2, upcoming_odds:1, upcoming_odds_three:1, corners:1, examples:6, earliest:'2025-01-01',latest:'2026-01-01' }];
describe('data coverage and control audit', () => {
  it('distinguishes clubs/nations, zero coverage and caches concurrent reads for five minutes', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('WITH stats AS')) return {rows};
      if (sql.includes('invalid_official')) return {rows:[{total:12,invalid_official:0,invalid_timing_known:0}]};
      return {rows:[]};
    });
    const service = new DataCoverageService({query} as never,['Eredivisie','WorldCup']);
    const [a,b] = await Promise.all([service.get(),service.get()]); await service.get();
    expect(a).toEqual(b); expect(query).toHaveBeenCalledTimes(5);
    expect(a.competitions[0]).toMatchObject({type:'CLUB',matches:5,matchesWithStats:3,matchesWithOdds:2,
      matchesWithThreeBookmakers:1,oddsSnapshots:18,csvHistoricalOddsMatches:3,csvHistoricalThreeBookmakers:2,
      csvHistoricalOddsQuotes:42,csvStageMatches:2,csvStageExamples:12,csvStageResearchEligible:9,
      upcomingMatches7d:2,upcomingMatchesWithOdds7d:1,
      target:{targetFinishedMatches:300,targetMatchesWithStats:210,needsBackfill:true}});
    expect(a.competitions[1]).toMatchObject({type:'INTERNATIONAL',matches:0,earliestMatch:null,
      target:{targetFinishedMatches:80,targetMatchesWithStats:56,needsBackfill:true}});
    expect(a.summary).toMatchObject({totalMatches:5,totalHistoricalExamples:6,totalOddsCovered:2,
      totalThreeBookmakerCovered:1,totalOddsSnapshots:18,csvHistoricalOddsMatches:3,csvHistoricalThreeBookmakers:2,
      csvHistoricalOddsQuotes:42,csvStageMatches:2,csvStageExamples:12,csvStageResearchEligible:9,
      upcomingMatches7d:2,upcomingOddsCovered7d:1});
    expect(coverageAuditChecks(a)[0]?.status).toBe('WARN');
    expect(coverageAuditChecks(a).find(item => item.key === 'DATA_TARGET_PROGRESS')?.status).toBe('WARN');
    expect(coverageAuditChecks(a).find(item => item.key === 'CSV_STAGE_SHADOW_ISOLATION')?.status).toBe('PASS');
    expect(coverageAuditChecks({...a,competitions:a.competitions.slice(0,1)})[0]?.status).toBe('PASS');
    expect(dataPoolCard(a)).toContain('Eredivisie');
    expect(dataPoolCard(a)).toContain('300');
    expect(dataPoolCard(a)).toContain('DATA_TARGET_V1');
  });
  it('reports fatal-before-fixtures as FAIL, partial failures WARN and clean imports PASS', () => {
    const base = {competitions:enrichCoverageTargets(coverageRows(rows,['Eredivisie'])),summary:{totalMatches:5,totalFinishedMatches:4,
      totalHistoricalExamples:6,totalOddsCovered:2,totalThreeBookmakerCovered:1,totalOddsSnapshots:18,
      csvHistoricalOddsMatches:3,csvHistoricalThreeBookmakers:2,csvHistoricalOddsQuotes:42,
      csvStageMatches:2,csvStageExamples:12,csvStageResearchEligible:9,
      upcomingMatches7d:2,upcomingOddsCovered7d:1,upcomingThreeBookmakerCovered7d:1,totalStatsCovered:3},
      backfills:[],publicCsvImports:[],publicCsvStageRefreshes:[],
      shadowSafety:{total:12,invalid_official:0,invalid_timing_known:0},
      targetPolicy:DATA_TARGET_V1,generatedAt:'now',cacheSeconds:300};
    const report = {...blankReport({id:57,key:'Eredivisie',name:'Eredivisie'},false),completedAt:new Date().toISOString()};
    expect(coverageAuditChecks({...base,backfills:[{...report,status:'FAILED',fixturesPersisted:0}]})[1]?.status).toBe('FAIL');
    expect(coverageAuditChecks({...base,backfills:[{...report,status:'PARTIAL',fixturesPersisted:3}]})[1]?.status).toBe('WARN');
    expect(coverageAuditChecks({...base,backfills:[{...report,status:'PASS',fixturesPersisted:3}]})[1]?.status).toBe('PASS');
  });
  it('serves coverage API with explicit zeros and escaped HTML', async () => {
    const service = new DataCoverageService({ query: async () => ({rows:[]}) } as never,['Eredivisie','WorldCup']);
    const config = loadConfig({DATABASE_URL:'postgresql://localhost/test',LOG_LEVEL:'silent'});
    const app = buildApp(config,{dataCoverage:()=>service.get()} as never,createLogger(config));
    try { const response = await app.inject('/api/data-coverage'); expect(response.statusCode).toBe(200);
      expect(response.json().summary.totalMatches).toBe(0);
      expect(response.json().summary.totalOddsSnapshots).toBe(0);
      expect(response.json().summary.csvHistoricalOddsQuotes).toBe(0);
      expect(response.json().summary.csvStageExamples).toBe(0);
      expect(response.json().shadowSafety.invalid_official).toBe(0);
      expect(response.json().summary.upcomingThreeBookmakerCovered7d).toBe(0);
      expect(response.json().targetPolicy).toMatchObject({clubFinishedMatches:300,internationalFinishedMatches:80,maxSeasonCycles:2});
      expect(response.headers['cache-control']).toContain('300');
      const data = await service.get(); data.competitions[0]!.competition='<script>alert(1)</script>';
      expect(dataPoolCard(data)).not.toContain('<script>alert');
    } finally {await app.close();}
  });
});
