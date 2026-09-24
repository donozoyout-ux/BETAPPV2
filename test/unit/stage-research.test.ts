import { describe, expect, it, vi } from 'vitest';
import { PredictionRepository } from '../../src/predictions/service.js';
import { stageResearchCard } from '../../src/predictions/stage-research-view.js';

describe('CSV_STAGE_RESEARCH_V1', () => {
  it('reports descriptive calibration while keeping unknown-timing evidence out of official Prediction V1', async () => {
    const query=vi.fn(async (sql:string)=>{
      if (sql.includes('GROUP BY l.id')) {
        expect(sql).toContain('e.official_eligible=false');
        expect(sql).toContain('e.timing_known=false');
        return {rows:[
          {competition:'Premier League',market_type:'MATCH_RESULT',market_name:'1X2',line:null,selection:'HOME',
            movement_class:'SUPPORT',examples:60,binary_examples:50,positive_examples:30,
            average_closing_fair_probability:'0.55',average_probability_delta_pp:'2.25',
            average_agreement:'0.80',average_reference_paper_return:'0.08'},
          {competition:'La Liga',market_type:'MATCH_RESULT',market_name:'1X2',line:null,selection:'HOME',
            movement_class:'SUPPORT',examples:90,binary_examples:80,positive_examples:50,
            average_closing_fair_probability:'0.58',average_probability_delta_pp:'2.0',
            average_agreement:'0.82',average_reference_paper_return:'0.10'},
        ]};
      }
      if (sql.includes('count(*)::int total')) {
        return {rows:[{total:150,research_eligible:140,invalid_official:0,invalid_timing_known:0,matches:70,competitions:2}]};
      }
      throw new Error('unexpected query');
    });
    const repository=new PredictionRepository({query} as never,['PremierLeague']);
    const report=await repository.csvStageResearch(100);
    expect(report).toMatchObject({
      version:'CSV_STAGE_RESEARCH_V1',researchOnly:true,exactCaptureTimeKnown:false,
      officialPredictionEligible:false,autoApply:false,executionAuthority:false,aiPredictionAuthority:false,
      summary:{total:150,researchEligible:140,invalidOfficial:0,invalidTimingKnown:0},
    });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({
      competition:'Premier League',binaryExamples:50,positiveExamples:30,positiveRate:0.6,
      averageClosingFairProbability:0.55,calibrationGapPp:5,referencePaperRoi:0.08,
      evidenceLevel:'DESCRIPTIVE',promotionEligible:false,promotionBlockedReason:'EXACT_CAPTURE_TIME_UNKNOWN',
    });
    expect(report.groups[0]!.wilsonLower95).not.toBeNull();
    expect(report.groups[0]!.wilsonUpper95).not.toBeNull();
    const html=stageResearchCard(report);
    expect(html).toContain('RESEARCH ONLY');
    expect(html).toContain('officialPredictionEligible=false');
  });

  it('labels small shadow groups as insufficient instead of treating them as model evidence', async () => {
    const query=vi.fn(async (sql:string)=>sql.includes('GROUP BY l.id') ? {rows:[{
      competition:'Premier League',market_type:'TOTAL_GOALS',market_name:'Total Goals',line:2.5,selection:'OVER',
      movement_class:'SUPPORT',examples:12,binary_examples:10,positive_examples:6,
      average_closing_fair_probability:'0.57',average_probability_delta_pp:'1.1',average_agreement:'0.7',
      average_reference_paper_return:'0.02',
    }]} : {rows:[{total:12,research_eligible:12,invalid_official:0,invalid_timing_known:0,matches:5,competitions:1}]});
    const report=await new PredictionRepository({query} as never,['PremierLeague']).csvStageResearch();
    expect(report.groups[0]).toMatchObject({evidenceLevel:'INSUFFICIENT_DATA',promotionEligible:false});
  });
});
