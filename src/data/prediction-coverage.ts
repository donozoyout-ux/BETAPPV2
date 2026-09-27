import type { DatabasePool } from '../db/pool.js';
import { predictionConfig } from '../predictions/config.js';
import { isCompetitionConfigured } from '../matching/competition.js';

type Numeric = number|string|null|undefined;
const n=(value:Numeric)=>Number(value??0);
export type PredictionCoverageTargetRow={match_id:string;competition:string;season:string|null;sample_count:Numeric;has_odds:boolean|null;
  complete_state:boolean|null;movement_available:boolean|null;fair_probability_available:boolean|null;team_metadata_complete:boolean|null;
  competition_metadata_complete:boolean|null;market_available:boolean|null;ready:boolean|null};
export type PredictionCoverageSummaryRow={total_matches:Numeric;settled_matches:Numeric;upcoming_matches:Numeric;cancelled_postponed:Numeric;
  earliest:string|null;latest:string|null};
export type PredictionCoverageGroupRow={scope:'COMPETITION'|'SEASON';label:string|null;settled_matches:Numeric;matches_with_odds:Numeric};

const buckets=(rows:PredictionCoverageTargetRow[])=>{
  const result={zero:0,oneToNine:0,tenToNineteen:0,twentyToTwentyNine:0,thirtyToFortyNine:0,
    fiftyToNinetyNine:0,hundredPlus:0};
  for(const row of rows){const count=n(row.sample_count);
    if(count===0)result.zero++;else if(count<10)result.oneToNine++;else if(count<20)result.tenToNineteen++;
    else if(count<30)result.twentyToTwentyNine++;else if(count<50)result.thirtyToFortyNine++;
    else if(count<100)result.fiftyToNinetyNine++;else result.hundredPlus++;
  }
  return result;
};

export function aggregatePredictionCoverage(summary:PredictionCoverageSummaryRow,groups:PredictionCoverageGroupRow[],targetRows:PredictionCoverageTargetRow[]){
  const sampleBuckets=buckets(targetRows);
  const count=(predicate:(row:PredictionCoverageTargetRow)=>boolean)=>targetRows.filter(predicate).length;
  const competitionRows=groups.filter(row=>row.scope==='COMPETITION').map(row=>{
    const targets=targetRows.filter(target=>target.competition===row.label);
    return {competition:row.label,settledMatches:n(row.settled_matches),matchesWithOdds:n(row.matches_with_odds),
      thirtyPlusSample:targets.filter(target=>n(target.sample_count)>=30).length,
      twentyPlusSample:targets.filter(target=>n(target.sample_count)>=20).length,
      zeroSample:targets.filter(target=>n(target.sample_count)===0).length};
  });
  const seasonRows=groups.filter(row=>row.scope==='SEASON').map(row=>{
    const targets=targetRows.filter(target=>target.season===row.label);
    return {season:row.label,settledMatches:n(row.settled_matches),matchesWithOdds:n(row.matches_with_odds),
      thirtyPlusSample:targets.filter(target=>n(target.sample_count)>=30).length,
      twentyPlusSample:targets.filter(target=>n(target.sample_count)>=20).length,
      zeroSample:targets.filter(target=>n(target.sample_count)===0).length};
  });
  const targetsWithOdds=count(row=>row.has_odds===true);
  return {
    totalMatches:n(summary.total_matches),settledMatches:n(summary.settled_matches),upcomingMatches:n(summary.upcoming_matches),
    cancelledPostponed:n(summary.cancelled_postponed),dateRange:{earliest:summary.earliest,latest:summary.latest},
    sampleBuckets,
    historicalCoverage:{thirtyPlus:count(row=>n(row.sample_count)>=30),twentyPlus:count(row=>n(row.sample_count)>=20),
      tenPlus:count(row=>n(row.sample_count)>=10),zero:sampleBuckets.zero},
    oddsCoverage:{withOdds:targetsWithOdds,withoutOdds:targetRows.length-targetsWithOdds,
      completeState:count(row=>row.has_odds===true&&row.complete_state===true),
      movementAvailable:count(row=>row.has_odds===true&&row.movement_available===true),
      fairProbabilityAvailable:count(row=>row.has_odds===true&&row.fair_probability_available===true)},
    metadataCoverage:{team:{complete:count(row=>row.team_metadata_complete===true),missing:count(row=>row.team_metadata_complete!==true),total:targetRows.length},
      competition:{complete:count(row=>row.competition_metadata_complete===true),missing:count(row=>row.competition_metadata_complete!==true),total:targetRows.length},
      market:{available:count(row=>row.market_available===true),missing:count(row=>row.market_available!==true),total:targetRows.length}},
    predictionReadiness:{ready:count(row=>row.ready===true),waitingForSample:count(row=>row.has_odds===true&&row.team_metadata_complete===true
      &&row.competition_metadata_complete===true&&n(row.sample_count)>0&&n(row.sample_count)<predictionConfig.minimumHistoricalSample),
      waitingForOdds:count(row=>row.has_odds!==true),waitingForMetadata:count(row=>row.has_odds===true
        &&(row.team_metadata_complete!==true||row.competition_metadata_complete!==true)),
      blockedByGate:count(row=>row.has_odds===true&&row.team_metadata_complete===true&&row.competition_metadata_complete===true
        &&n(row.sample_count)>=predictionConfig.minimumHistoricalSample&&row.ready!==true),
      noHistoricalData:count(row=>row.has_odds===true&&row.team_metadata_complete===true&&row.competition_metadata_complete===true
        &&n(row.sample_count)===0)},
    competitionCoverage:competitionRows,seasonCoverage:seasonRows,
    scope:{targetWindow:'scheduled matches kicking off after query time and within 48 hours',
      sample:'maximum compatible settled binary historical examples among available markets, capped at 250 per market',
      historicalCutoff:'historical kickoff_at < target kickoff_at',writeOperations:0},
  };
}

export class PredictionCoverageService{
  private cached:{expiresAt:number;value:ReturnType<typeof aggregatePredictionCoverage>}|null=null;
  constructor(private readonly pool:DatabasePool,private readonly configured:readonly string[]){}
  async get(now=new Date()){
    if(this.cached&&this.cached.expiresAt>Date.now())return this.cached.value;
    const cfg=predictionConfig;
    const leagueNamesResult=await this.pool.query<{name:string}>('SELECT name FROM leagues WHERE name IS NOT NULL');
    const supportedLeagueNames:string[]=leagueNamesResult.rows.map((row:{name:string})=>row.name)
      .filter((name:string)=>isCompetitionConfigured(name,this.configured));
    const [summaryResult,groupsResult,targetResult]=await Promise.all([
      this.pool.query<PredictionCoverageSummaryRow>(`WITH odds AS(
        SELECT DISTINCT o.match_id FROM odds_snapshots o JOIN matches om ON om.id=o.match_id
        WHERE o.captured_at<om.kickoff_at AND o.odds_decimal>1
      ) SELECT count(*)::int total_matches,
        count(*) FILTER(WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL)::int settled_matches,
        count(*) FILTER(WHERE m.status='scheduled' AND m.kickoff_at>now())::int upcoming_matches,
        count(*) FILTER(WHERE m.status IN('cancelled','postponed'))::int cancelled_postponed,
        min(m.kickoff_at)::text earliest,max(m.kickoff_at)::text latest FROM matches m`),
      this.pool.query<PredictionCoverageGroupRow>(`WITH odds AS(
        SELECT DISTINCT o.match_id FROM odds_snapshots o JOIN matches om ON om.id=o.match_id
        WHERE o.captured_at<om.kickoff_at AND o.odds_decimal>1
      ) SELECT 'COMPETITION'::text scope,l.name label,
        count(m.id) FILTER(WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL)::int settled_matches,
        count(m.id) FILTER(WHERE o.match_id IS NOT NULL)::int matches_with_odds
        FROM leagues l LEFT JOIN matches m ON m.league_id=l.id LEFT JOIN odds o ON o.match_id=m.id GROUP BY l.id,l.name
        UNION ALL SELECT 'SEASON'::text scope,COALESCE(m.season,'(unknown)') label,
        count(m.id) FILTER(WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL)::int settled_matches,
        count(m.id) FILTER(WHERE o.match_id IS NOT NULL)::int matches_with_odds
        FROM matches m LEFT JOIN odds o ON o.match_id=m.id GROUP BY m.season ORDER BY scope,label`),
      this.pool.query<PredictionCoverageTargetRow>(`WITH targets AS(
        SELECT m.id match_id,m.kickoff_at,m.league_id,COALESCE(m.season,'(unknown)') season,l.name competition,l.name IS NOT NULL AND btrim(l.name)<>'' competition_metadata_complete,
          ht.name home_team,at.name away_team,ht.name IS NOT NULL AND btrim(ht.name)<>'' AND at.name IS NOT NULL AND btrim(at.name)<>'' team_metadata_complete
        FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
        WHERE m.status='scheduled' AND m.kickoff_at > $1::timestamptz
          AND m.kickoff_at < $1::timestamptz+interval '48 hours'
      ), latest_items AS(
        SELECT t.*,i.market_type,i.market_name,i.line,i.selection,i.opening_odds,i.current_odds,
          i.opening_fair_probability,i.current_fair_probability,i.probability_delta_pp,i.movement_agreement_ratio,
          i.analysis_eligible,i.data_quality_score,i.confidence_score,i.bookmaker_count,i.complete_state_bookmaker_count,
          i.minimum_complete_state_count,i.movement_class,i.model_market_gap_pp
        FROM targets t LEFT JOIN LATERAL(SELECT id FROM odds_analysis_runs r WHERE r.match_id=t.match_id
          ORDER BY r.created_at DESC,r.id DESC LIMIT 1) r ON true
        LEFT JOIN odds_analysis_items i ON i.run_id=r.id
      ), compatible AS(
        SELECT i.match_id,i.competition,i.season,i.market_type,i.market_name,i.line,i.selection,e.id historical_id,
          e.kickoff_at historical_event_time,e.competition_id=i.league_id same_competition,
          e.settlement_result,
          (abs(i.opening_fair_probability-e.opening_fair_probability)*100/$2
           +abs(i.current_fair_probability-e.current_fair_probability)*100/$3
           +abs(i.probability_delta_pp-e.probability_delta_pp)/$4
           +abs(i.opening_odds-e.opening_odds)/i.opening_odds*100/$5
           +abs(i.current_odds-e.current_odds)/i.current_odds*100/$6
           +abs(i.movement_agreement_ratio-e.movement_agreement_ratio)/$7)/6.0 distance
        FROM latest_items i JOIN prediction_historical_examples e ON e.analysis_eligible=true AND e.kickoff_at<i.kickoff_at
          AND e.market_type=i.market_type AND e.market_name=i.market_name AND e.line IS NOT DISTINCT FROM i.line AND e.selection=i.selection
          AND e.competition_id IN(SELECT id FROM leagues WHERE name=ANY($25::text[]))
          AND i.opening_odds>0 AND i.current_odds>0
          AND abs(i.opening_fair_probability-e.opening_fair_probability)*100<=$2
          AND abs(i.current_fair_probability-e.current_fair_probability)*100<=$3
          AND abs(i.probability_delta_pp-e.probability_delta_pp)<=$4
          AND abs(i.opening_odds-e.opening_odds)/i.opening_odds*100<=$5
          AND abs(i.current_odds-e.current_odds)/i.current_odds*100<=$6
          AND abs(i.movement_agreement_ratio-e.movement_agreement_ratio)<=$7
      ), scoped AS(
        SELECT c.*,count(*) FILTER(WHERE c.same_competition AND c.settlement_result NOT IN('PUSH','VOID'))
          OVER(PARTITION BY c.match_id,c.market_type,c.market_name,c.line,c.selection) local_settled_count
        FROM compatible c
      ), ranked AS(
        SELECT s.*,row_number() OVER(PARTITION BY s.match_id,s.market_type,s.market_name,s.line,s.selection
          ORDER BY s.distance,s.historical_event_time,s.historical_id) sample_rank
        FROM scoped s WHERE (s.local_settled_count >= $8 AND s.same_competition) OR s.local_settled_count < $8
      ), evidence AS(
        SELECT match_id,market_type,market_name,line,selection,count(*) FILTER(WHERE sample_rank<=$9)::int sample_size,
          count(*) FILTER(WHERE sample_rank<=$9 AND settlement_result NOT IN('PUSH','VOID'))::int settled_count
        FROM ranked GROUP BY match_id,market_type,market_name,line,selection
      ) SELECT i.match_id,i.competition,i.season,COALESCE(max(e.settled_count),0)::int sample_count,
        bool_or(i.market_type IS NOT NULL) has_odds,
        bool_or(COALESCE(i.complete_state_bookmaker_count,0)>=$10 AND COALESCE(i.minimum_complete_state_count,0)>=$11) complete_state,
        bool_or(i.movement_class IN('SUPPORT','STRONG_SUPPORT')) movement_available,
        bool_or(i.current_fair_probability IS NOT NULL) fair_probability_available,
        bool_or(i.team_metadata_complete) team_metadata_complete,
        bool_or(i.competition_metadata_complete) competition_metadata_complete,
        bool_or(i.market_type IS NOT NULL) market_available,
        bool_or(i.market_type IS NOT NULL AND i.market_type ILIKE ANY(ARRAY['%MATCH_RESULT%','%1X2%','%TOTAL_GOALS%','%TOTAL_CORNERS%','%ASIAN_HANDICAP%'])
          AND i.analysis_eligible=true AND i.data_quality_score >= $12 AND i.confidence_score >= $13
          AND i.bookmaker_count >= $14 AND i.complete_state_bookmaker_count >= $14 AND i.minimum_complete_state_count >= $11
          AND i.movement_class IN('SUPPORT','STRONG_SUPPORT') AND COALESCE(e.settled_count,0)>=$8
          AND (i.market_type NOT ILIKE '%TOTAL_CORNERS%' OR i.model_market_gap_pp IS NULL
            OR (i.selection='OVER' AND i.model_market_gap_pp > -$15) OR (i.selection='UNDER' AND i.model_market_gap_pp < $15))
          AND round(round(i.current_fair_probability*$16,2)
            +round(LEAST(1.0,GREATEST(0.0,i.probability_delta_pp/5.0))*$17,2)
            +round(COALESCE((SELECT sum(CASE WHEN r.settlement_result IN('WIN','HALF_WIN') THEN 1 ELSE 0 END)::numeric
              /NULLIF(count(*) FILTER(WHERE r.settlement_result NOT IN('PUSH','VOID')),0) FROM ranked r
              WHERE r.match_id=i.match_id AND r.market_type=i.market_type AND r.market_name=i.market_name
                AND r.line IS NOT DISTINCT FROM i.line AND r.selection=i.selection AND r.sample_rank<=$9),0)*$18,2)
              +round(LEAST(1.0,COALESCE(e.settled_count,0)::numeric/$19)*$20,2)
            +round(i.movement_agreement_ratio*$21,2)+round(i.data_quality_score/100.0*$22,2)
            +round(i.confidence_score/100.0*$23,2),2)>=$24) ready
        FROM latest_items i LEFT JOIN evidence e ON e.match_id=i.match_id AND e.market_type=i.market_type AND e.market_name=i.market_name
          AND e.line IS NOT DISTINCT FROM i.line AND e.selection=i.selection
        GROUP BY i.match_id,i.competition,i.season`,[now,cfg.openingProbabilityTolerancePp,cfg.currentProbabilityTolerancePp,
        cfg.movementTolerancePp,cfg.openingOddsTolerancePercent,cfg.currentOddsTolerancePercent,cfg.agreementTolerance,
        cfg.minimumHistoricalSample,cfg.maximumHistoricalExamples,cfg.minimumBookmakerCount,cfg.minimumCompleteStateCount,
        cfg.minimumDataQualityScore,cfg.minimumConfidenceScore,cfg.minimumBookmakerCount,cfg.cornerConflictGapPp,
        cfg.scoreWeights.marketProbability,cfg.scoreWeights.oddsSignal,cfg.scoreWeights.historicalEvidence,
        cfg.targetHistoricalSample,cfg.scoreWeights.historicalSampleReliability,cfg.scoreWeights.bookmakerAgreement,
        cfg.scoreWeights.dataQuality,cfg.scoreWeights.modelConfidence,cfg.minimumPredictionScore,supportedLeagueNames]),
    ]);
    const targetRows=targetResult.rows.filter(row=>isCompetitionConfigured(row.competition,this.configured));
    const value=aggregatePredictionCoverage(summaryResult.rows[0]??{total_matches:0,settled_matches:0,upcoming_matches:0,
      cancelled_postponed:0,earliest:null,latest:null},groupsResult.rows,targetRows);
    this.cached={expiresAt:Date.now()+60_000,value};
    return value;
  }
}
