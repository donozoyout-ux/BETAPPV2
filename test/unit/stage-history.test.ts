import { describe, expect, it, vi } from 'vitest';
import { buildStageHistoricalExamples } from '../../src/predictions/stage-history.js';
import { PredictionRepository } from '../../src/predictions/service.js';

const match = {
  matchId:'m1',competitionId:'l1',kickoffAt:new Date('2026-05-01T18:00:00Z'),sourceKey:'football-data:2526:E0',
  status:'finished',homeScore:2,awayScore:1,homeCorners:6,awayCorners:4,
};

function marketRows(bookmaker: string, opening: [number,number,number], closing: [number,number,number]) {
  const selections=['HOME','DRAW','AWAY'] as const;
  return selections.flatMap((selection,index)=>[
    {bookmaker,market_type:'MATCH_RESULT',market_name:'1X2',line:null,selection,odds_decimal:opening[index]!,
      observation_stage:'PRE_CLOSING' as const,source_row_hash:'row'},
    {bookmaker,market_type:'MATCH_RESULT',market_name:'1X2',line:null,selection,odds_decimal:closing[index]!,
      observation_stage:'CLOSING' as const,source_row_hash:'row'},
  ]);
}

describe('CSV_STAGE_V1 shadow historical evidence', () => {
  it('builds research evidence only from complete opening and closing bookmaker states', () => {
    const odds=[
      ...marketRows('bet365',[2.10,3.40,3.50],[1.82,3.60,4.10]),
      ...marketRows('pinnacle',[2.05,3.45,3.55],[1.85,3.55,4.00]),
      ...marketRows('betfair',[2.12,3.35,3.48],[1.84,3.58,4.05]),
    ];
    const examples=buildStageHistoricalExamples({...match,odds});
    expect(examples).toHaveLength(3);
    const home=examples.find((item)=>item.selection==='HOME')!;
    expect(home).toMatchObject({
      researchEligible:true,bookmakerCount:3,marketType:'MATCH_RESULT',marketName:'1X2',settlementResult:'WIN',
    });
    expect(home.closingOdds).toBeLessThan(home.openingOdds);
    expect(home.closingFairProbability).toBeGreaterThan(home.openingFairProbability);
    expect(home.probabilityDeltaPp).toBeGreaterThan(0);
    expect(home.movementAgreementRatio).toBe(1);
  });

  it('keeps thin stage data for research but marks it ineligible below three bookmakers', () => {
    const examples=buildStageHistoricalExamples({...match,odds:[
      ...marketRows('bet365',[2.10,3.40,3.50],[1.90,3.50,3.80]),
      ...marketRows('pinnacle',[2.05,3.45,3.55],[1.92,3.48,3.75]),
    ]});
    expect(examples).toHaveLength(3);
    expect(examples.every((item)=>item.researchEligible===false)).toBe(true);
  });

  it('does not manufacture movement from a bookmaker missing a closing state', () => {
    const odds=marketRows('bet365',[2.10,3.40,3.50],[1.90,3.50,3.80])
      .filter((row)=>!(row.observation_stage==='CLOSING' && row.selection==='DRAW'));
    expect(buildStageHistoricalExamples({...match,odds})).toEqual([]);
  });

  it('keeps the official Prediction V1 historical loader isolated from the shadow table', async () => {
    const query=vi.fn(async (sql:string)=>{
      expect(sql).toContain('FROM prediction_historical_examples e');
      expect(sql).not.toContain('prediction_stage_historical_examples');
      return {rows:[]};
    });
    const repository=new PredictionRepository({query} as never);
    await expect(repository.loadHistoricalExamples()).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
