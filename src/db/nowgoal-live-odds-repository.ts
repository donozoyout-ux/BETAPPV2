import type { AppConfig } from '../config.js';
import { isCompetitionConfigured } from '../matching/competition.js';
import type { DatabasePool } from './pool.js';
import type { LiveOddsObservation } from '../providers/nowgoal-live-odds.js';

export type LiveOddsCandidate = { matchId: string; nowgoalMatchId: string; status: string; competition: string;
  homeTeam: string; awayTeam: string; kickoffAt: Date };
export class NowgoalLiveOddsRepository {
  constructor(private readonly pool: DatabasePool) {}

  async matchDetail(matchId:string) {
    const match=await this.pool.query('SELECT m.id,m.kickoff_at,m.status,m.home_score,m.away_score,l.name league,ht.name home_team,at.name away_team FROM matches m JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id WHERE m.id=$1',[matchId]);
    if(!match.rows[0])return null;
    const observations=await this.pool.query('SELECT * FROM nowgoal_live_odds_snapshots WHERE match_id=$1 ORDER BY captured_at DESC,match_minute DESC NULLS LAST,bookmaker,period LIMIT 500',[matchId]);
    const tracking=(await this.pool.query('SELECT * FROM nowgoal_live_match_tracking WHERE match_id=$1',[matchId])).rows[0];
    const all=observations.rows;
    return {...match.rows[0],observations:all,liveOddsStatus:tracking?.last_status??(all.length?'AVAILABLE':'NO_DATA'),
      observationCount:all.length,bookmakerCount:new Set(all.map((row)=>row.bookmaker).filter(Boolean)).size,
      ftCount:all.filter((row)=>row.period==='FT').length,htCount:all.filter((row)=>row.period==='HT').length,
      lastCaptureAt:tracking?.last_capture_at??all[0]?.captured_at??null,
      postgresStatus:tracking?'AVAILABLE':all.length?'AVAILABLE':'NO_DATA',sheetSyncStatus:all.some((row)=>row.sheet_synced_at==null)?'PENDING':all.length?'SYNCED':'NO_DATA'};
  }

  async trackingCandidates(config: AppConfig): Promise<{ configured: boolean; analyzedMatches:number|null; matches: LiveOddsCandidate[] }> {
    const available = await this.pool.query<{ available: boolean }>("SELECT to_regclass('prediction_runs') IS NOT NULL AS available");
    if (!available.rows[0]?.available) return { configured: false, analyzedMatches:null, matches: [] };
    const analyzedMatches=Number((await this.pool.query<{count:number}>('SELECT count(DISTINCT match_id)::integer count FROM prediction_runs')).rows[0]?.count??0);
    const rows = await this.pool.query<LiveOddsCandidate>(`SELECT DISTINCT ON(m.id) m.id match_id,os.provider_match_id nowgoal_match_id,
        m.status,l.name competition,ht.name home_team,at.name away_team,m.kickoff_at
      FROM prediction_runs pr JOIN matches m ON m.id=pr.match_id AND pr.decision='PREDICT'
      JOIN leagues l ON l.id=m.league_id JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
      JOIN odds_snapshots os ON os.match_id=m.id AND os.provider LIKE 'nowgoal:%'
      JOIN provider_entities pe ON pe.provider=split_part(os.provider,':',1) AND pe.entity_type='match' AND pe.external_id=os.provider_match_id AND pe.internal_id=m.id
      LEFT JOIN nowgoal_live_match_tracking tr ON tr.match_id=m.id
      WHERE m.kickoff_at<=now() AND m.status IN ('scheduled','live','finished')
        AND (m.status<>'finished' OR tr.finished_final_capture_at IS NULL)
        AND os.provider_match_id ~ '^[0-9]+$'
      ORDER BY m.id,os.captured_at DESC`);
    return { configured: true, analyzedMatches, matches: rows.rows.filter((row) => isCompetitionConfigured(row.competition,config.SUPPORTED_COMPETITIONS)) };
  }

  async saveObservations(matchId: string, observations: LiveOddsObservation[]) {
    const client = await this.pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const item of observations) {
        const result = await client.query(`INSERT INTO nowgoal_live_odds_snapshots(
          match_id,nowgoal_match_id,source_url,captured_at,match_minute,minute_label,score_home,score_away,score_text,period,bookmaker,
          ah_initial_home,ah_initial_line,ah_initial_away,ah_live_home,ah_live_line,ah_live_away,
          one_x_two_initial_home,one_x_two_initial_draw,one_x_two_initial_away,
          one_x_two_live_home,one_x_two_live_draw,one_x_two_live_away,
          ou_initial_over,ou_initial_line,ou_initial_under,ou_live_over,ou_live_line,ou_live_under,
          parser_version,raw_hash,raw_payload)
          VALUES(${Array.from({length:32},(_,i)=>`$${i+1}`).join(',')}) ON CONFLICT DO NOTHING RETURNING id`,
        [matchId,item.nowgoalMatchId,item.sourceUrl,item.capturedAt,item.matchMinute,item.minuteLabel,item.scoreHome,item.scoreAway,item.scoreText,item.period,item.bookmaker,
          item.ahInitialHome,item.ahInitialLine,item.ahInitialAway,item.ahLiveHome,item.ahLiveLine,item.ahLiveAway,
          item.oneXTwoInitialHome,item.oneXTwoInitialDraw,item.oneXTwoInitialAway,item.oneXTwoLiveHome,item.oneXTwoLiveDraw,item.oneXTwoLiveAway,
          item.ouInitialOver,item.ouInitialLine,item.ouInitialUnder,item.ouLiveOver,item.ouLiveLine,item.ouLiveUnder,
          item.parserVersion,item.rawHash,JSON.stringify(item.rawPayload)]);
        inserted += result.rowCount ?? 0;
      }
      const duplicates=observations.length-inserted;
      const status=observations.length?'AVAILABLE':'NO_DATA';
      await client.query(`INSERT INTO nowgoal_live_match_tracking(match_id,last_capture_at,last_status,last_error,duplicates_blocked,updated_at)
        VALUES($1,now(),$3,NULL,$2,now()) ON CONFLICT(match_id) DO UPDATE SET
        last_capture_at=excluded.last_capture_at,last_status=$3,last_error=NULL,
        duplicates_blocked=nowgoal_live_match_tracking.duplicates_blocked+$2,updated_at=now()`,[matchId,duplicates,status]);
      await client.query('COMMIT');
      return inserted;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async markFinishedCapture(matchId: string,status:'AVAILABLE'|'NO_DATA'='AVAILABLE') {
    await this.pool.query(`INSERT INTO nowgoal_live_match_tracking(match_id,finished_final_capture_at,last_capture_at,last_status,updated_at)
      VALUES($1,now(),now(),$2,now()) ON CONFLICT(match_id) DO UPDATE SET
      finished_final_capture_at=now(),last_capture_at=now(),last_status=$2,last_error=NULL,updated_at=now()`,[matchId,status]);
  }
  async markCaptureFailure(matchId: string,status: string,error: unknown) {
    const detail=(error instanceof Error?error.message:String(error)).slice(0,1000);
    await this.pool.query(`INSERT INTO nowgoal_live_match_tracking(match_id,last_capture_at,last_status,last_error,updated_at)
      VALUES($1,now(),$2,$3,now()) ON CONFLICT(match_id) DO UPDATE SET last_capture_at=now(),last_status=$2,last_error=$3,updated_at=now()`,[matchId,status,detail]);
  }
  async latestStatus() {
    const result=await this.pool.query(`SELECT count(*)::integer tracked,
      count(*) FILTER(WHERE last_status='AVAILABLE')::integer available,
      count(*) FILTER(WHERE last_status='BLOCKED')::integer blocked,
      max(last_capture_at) last_capture_at,
      (SELECT count(*)::integer FROM nowgoal_live_odds_snapshots WHERE captured_at>=now()-interval '1 hour')::integer recent_observations
      FROM nowgoal_live_match_tracking`);
    return result.rows[0];
  }
  async unsynced(limit=500) {
    return (await this.pool.query(`SELECT id,match_id,nowgoal_match_id,source_url,captured_at,match_minute,minute_label,
      score_home,score_away,score_text,period,bookmaker,ah_initial_home,ah_initial_line,ah_initial_away,ah_live_home,ah_live_line,ah_live_away,
      one_x_two_initial_home,one_x_two_initial_draw,one_x_two_initial_away,one_x_two_live_home,one_x_two_live_draw,one_x_two_live_away,
      ou_initial_over,ou_initial_line,ou_initial_under,ou_live_over,ou_live_line,ou_live_under,parser_version,raw_hash
      FROM nowgoal_live_odds_snapshots WHERE sheet_synced_at IS NULL
      ORDER BY match_id,bookmaker,period,match_minute NULLS FIRST,captured_at,id LIMIT $1`,[limit])).rows;
  }
  async markSheetSynced(ids: string[]) {
    if (ids.length) await this.pool.query('UPDATE nowgoal_live_odds_snapshots SET sheet_synced_at=now() WHERE id=ANY($1::uuid[])',[ids]);
  }
}
