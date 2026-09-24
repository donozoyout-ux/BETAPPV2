import { routeCandidates } from './repository.js';
import type { HistoricalNeighborInput, MatchOutcomeData } from './types.js';
import type { OddsSnapshot } from '../odds-analysis/types.js';
export const calibrationMetadataSql = `SELECT now() extracted_at,count(*)::int total_matches,
 count(*) FILTER(WHERE status='finished')::int finished_matches,
 count(*) FILTER(WHERE status='finished' AND EXISTS(SELECT 1 FROM odds_snapshots o WHERE o.match_id=m.id AND o.captured_at<m.kickoff_at AND o.odds_decimal>1))::int finished_with_odds,
 min(kickoff_at) FILTER(WHERE status='finished') date_from,max(kickoff_at) FILTER(WHERE status='finished') date_to
 FROM matches m`;
// Export only stored finished matches with genuine pre-kickoff odds. No source payloads or credentials.
export const calibrationRowsSql = `SELECT m.id match_id,m.league_id competition_id,m.kickoff_at,l.name league,l.country,
 ht.name home_team,at.name away_team,m.home_score,m.away_score,h.home_corners,h.away_corners,
 h.home_yellow_cards,h.away_yellow_cards,h.home_red_cards,h.away_red_cards,
 (SELECT jsonb_agg(jsonb_build_object('matchId',o.match_id,'provider',o.provider,'marketType',o.market_type,
 'marketName',o.market_name,'line',o.line,'selection',o.selection,'oddsDecimal',o.odds_decimal,'capturedAt',o.captured_at) ORDER BY o.captured_at,o.id)
 FROM odds_snapshots o WHERE o.match_id=m.id AND o.captured_at<m.kickoff_at AND o.odds_decimal>1) snapshots
 FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
 LEFT JOIN historical_match_stats h ON h.match_id=m.id
 WHERE m.status='finished' AND m.kickoff_at<=now()
 AND EXISTS(SELECT 1 FROM odds_snapshots o WHERE o.match_id=m.id AND o.captured_at<m.kickoff_at AND o.odds_decimal>1)
 ORDER BY m.kickoff_at,m.id LIMIT 10001`;
export function decodeCalibrationRows(rows:Array<Record<string,unknown>>) {
 if(rows.length>10000)throw new Error('Export exceeds 10000 odds-covered matches; explicit population sampling required');
 let matchesWithRoutes=0,snapshotCount=0;const records:HistoricalNeighborInput[]=[];
 for(const row of rows){
  const number=(key:string)=>row[key]==null?null:Number(row[key]);
  const data:MatchOutcomeData={matchId:String(row.match_id),competitionId:row.competition_id==null?'':String(row.competition_id),country:row.country==null?null:String(row.country),kickoffAt:new Date(String(row.kickoff_at)),league:String(row.league),homeTeam:String(row.home_team),awayTeam:String(row.away_team),
   homeScore:number('home_score'),awayScore:number('away_score'),firstHalfHomeScore:null,firstHalfAwayScore:null,homeCorners:number('home_corners'),awayCorners:number('away_corners'),homeYellowCards:number('home_yellow_cards'),awayYellowCards:number('away_yellow_cards'),homeRedCards:number('home_red_cards'),awayRedCards:number('away_red_cards')};
  const snapshots=(row.snapshots??[]) as Array<Record<string,unknown>>;snapshotCount+=snapshots.length;
  const parsed:OddsSnapshot[]=snapshots.map(s=>({matchId:String(s.matchId),provider:String(s.provider),marketType:String(s.marketType),marketName:String(s.marketName),line:s.line==null?null:Number(s.line),selection:String(s.selection),oddsDecimal:Number(s.oddsDecimal),capturedAt:new Date(String(s.capturedAt))}));
  const routes=routeCandidates(data,parsed,data.kickoffAt);if(routes.length)matchesWithRoutes++;
  records.push(...routes.map(route=>({...data,route})));
 }
 return {records,matchesExamined:rows.length,matchesWithRoutes,matchesWithoutRoutes:rows.length-matchesWithRoutes,snapshotCount};
}
