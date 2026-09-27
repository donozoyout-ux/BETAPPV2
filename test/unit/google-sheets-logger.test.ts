import {describe,expect,it,vi} from 'vitest';
import {GoogleSheetsLogger, LIVE_ODDS_COLUMN_ORDER, PREDICTIONS_COLUMN_ORDER, toLiveOddsSheetRow, toPredictionSheetRow} from '../../src/integrations/google-sheets-logger.js';
import type {PredictionJournalSheetRow, PredictionJournalSheetSource} from '../../src/integrations/google-sheets-logger.js';

const liveRecord = {
  match_id:'match-1', nowgoal_match_id:'ng-11', source_url:'https://nowgoal.test/match/11',
  captured_at:new Date('2026-09-27T10:00:00Z'), match_minute:'67', minute_label:'67\'',
  score_home:2, score_away:1, period:'2H', bookmaker:'Book A', score_text:null,
  ah_initial_home:'0.91', ah_initial_line:'-0.5', ah_initial_away:'0.97', ah_live_home:'0.88', ah_live_line:'-0.75', ah_live_away:'1.02',
  one_x_two_initial_home:'2.1', one_x_two_initial_draw:'3.2', one_x_two_initial_away:'3.5',
  one_x_two_live_home:'1.7', one_x_two_live_draw:'3.8', one_x_two_live_away:'5.1',
  ou_initial_over:'0.95', ou_initial_line:'2.5', ou_initial_under:'0.93', ou_live_over:'1.04', ou_live_line:'3', ou_live_under:'0.84',
  parser_version:'v2', raw_hash:'sha256:abc',
} as const;

const journalRow: PredictionJournalSheetRow = {
  logged_at:'2026-09-27T10:00:00.000Z',match_id:'match-1',home_team:'Home',away_team:'Away',league:'League',kickoff_at:'2026-09-28T12:00:00.000Z',
  market:'TOTAL_GOALS',selection:'OVER',line:'2.5',decision:'PREDICT',skip_code:null,prediction_score:78,
  score_market_probability:72,score_odds_signal:81,score_historical_evidence:69,score_sample_reliability:60,score_bookmaker_agreement:90,
  score_data_quality:88,score_model_confidence:75,historical_sample_n:34,bookmaker_count:8,movement_class:'SUPPORTED',
  data_quality_grade:'GOOD',model_confidence_grade:'LIMITED',movement_class:'SUPPORT',config_hash:'config',input_hash:'input',
};

function journalSource(): PredictionJournalSheetSource {
  return {
    lockedAt:new Date(journalRow.logged_at),
    target:{matchId:'match-1',competitionId:'league-1',kickoffAt:new Date(journalRow.kickoff_at),oddsInputHash:'input',oddsItems:[],
      competitionName:'League',homeTeamName:'Home',awayTeamName:'Away'},
    evaluation:{matchId:'match-1',competitionId:'league-1',kickoffAt:new Date(journalRow.kickoff_at),modelVersion:'PREDICTION_V1',
      configHash:'config',inputHash:'input',oddsAnalysisInputHash:'odds',generatedAt:new Date(journalRow.logged_at),decision:'PREDICT',
      selectedCandidate:{marketType:'TOTAL_GOALS',marketName:'Total Goals',line:2.5,selection:'OVER',referenceOdds:1.9,openingOdds:2,
        currentOdds:1.9,currentFairProbability:0.54,probabilityDeltaPp:3,predictionScore:78,
        scoreComponents:{marketProbability:72,oddsSignal:81,historicalEvidence:69,historicalSampleReliability:60,bookmakerAgreement:90,dataQuality:88,modelConfidence:75},
        bookmakerCount:8,agreementRatio:0.9,dataQualityScore:88,dataQualityGrade:'GOOD',confidenceScore:75,confidenceGrade:'LIMITED',movementClass:'SUPPORT',
        analysisEligible:true,snapshotCount:12,completeStateBookmakerCount:8,minimumCompleteStateCount:5,
        historical:{exampleIds:[],sampleSize:34,settledSampleSize:30,wins:18,losses:12,pushes:0,halfWins:0,halfLosses:0,historicalHitRate:0.6,
          wilsonLower95:0.4,wilsonUpper95:0.75,averageSimilarity:0.8,scope:'SAME_COMPETITION',historicalFrequencyGapPp:2,status:'SUFFICIENT'},
        cornerModelProbability:null,marketFairProbability:0.54,modelMarketGapPp:null,cornerQuality:null,cornerConfirmation:'UNAVAILABLE',reasons:[],warnings:[]},
      candidates:[],skipReasons:[],metadata:{executionAuthority:false,aiPredictionAuthority:false,historicalExamplesConsidered:34}},
  };
}

function createLogger() {
  const valuesAppend=vi.fn(async()=>({data:{}}));
  const valuesGet=vi.fn(async()=>({data:{values:[]}}));
  const valuesUpdate=vi.fn(async()=>({data:{}}));
  const spreadsheetsGet=vi.fn(async()=>({data:{sheets:[{properties:{title:'Predictions_Journal'}}]}}));
  const batchUpdate=vi.fn(async()=>({data:{}}));
  const logger=new GoogleSheetsLogger({GOOGLE_SHEETS_ID:'sheet',GOOGLE_SERVICE_ACCOUNT_EMAIL:'bot@example.com',GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:'private'},
    {warn:vi.fn()} as never,()=>({spreadsheets:{get:spreadsheetsGet,batchUpdate,values:{append:valuesAppend,get:valuesGet,update:valuesUpdate}}} as never));
  return {logger,valuesAppend,valuesGet,valuesUpdate,spreadsheetsGet,batchUpdate};
}

describe('Google Sheets logger adapters',()=>{
  it('maps a persisted Nowgoal live odds observation into the fixed 30-column contract',()=>{
    const row=toLiveOddsSheetRow(liveRecord);
    expect(Object.keys(row)).toEqual([...LIVE_ODDS_COLUMN_ORDER]);
    expect(row).toMatchObject({match_id:'match-1',captured_at:'2026-09-27T10:00:00.000Z',score:'2:1',ah_initial_home:0.91,
      ah_initial_line:-0.5,one_x_two_live_away:5.1,ou_live_line:3,observation_identity:'match-1|ng-11|67|2|1|2H|Book A|sha256:abc'});
  });

  it('maps a newly locked prediction and preserves the separate score components',()=>{
    const row=toPredictionSheetRow(journalSource());
    expect(Object.keys(row)).toEqual([...PREDICTIONS_COLUMN_ORDER]);
    expect(row).toEqual(journalRow);
    const skip=toPredictionSheetRow({...journalSource(),evaluation:{...journalSource().evaluation,decision:'SKIP',selectedCandidate:null,skipReasons:['LOW_DATA_QUALITY'] as never}});
    expect(skip).toMatchObject({decision:'SKIP',skip_code:'LOW_DATA_QUALITY',prediction_score:null,historical_sample_n:0});
  });

  it('mocks Sheets API calls, creates/validates the journal header, then appends mapped values',async()=>{
    const api=createLogger();
    expect(await api.logger.appendPredictionJournalRows([journalRow])).toBe(true);
    expect(api.spreadsheetsGet).toHaveBeenCalledTimes(1);
    expect(api.valuesGet).toHaveBeenCalledWith(expect.objectContaining({range:'Predictions_Journal!A1:Z1'}));
    expect(api.valuesUpdate).toHaveBeenCalledWith(expect.objectContaining({requestBody:{values:[[...PREDICTIONS_COLUMN_ORDER]]}}));
    expect(api.valuesAppend).toHaveBeenCalledWith(expect.objectContaining({range:'Predictions_Journal!A1',requestBody:{values:[[...PREDICTIONS_COLUMN_ORDER.map((key)=>journalRow[key as keyof PredictionJournalSheetRow] ?? '')]]}}));
  });

  it('treats Google Sheets API errors as a logged best-effort failure',async()=>{
    const api=createLogger();api.valuesAppend.mockRejectedValueOnce(new Error('offline'));
    const result=await api.logger.appendLiveOddsRows([toLiveOddsSheetRow(liveRecord)]);
    expect(result).toBe(false);
    expect(api.valuesAppend).toHaveBeenCalledTimes(1);
  });
});
