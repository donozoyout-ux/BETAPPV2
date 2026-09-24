import type { DatabasePool } from '../db/pool.js';
import type { Logger } from '../logger.js';
import { buildStageHistoricalExamples, type ArchivedStageOddRow } from './stage-history.js';

export class StageHistoricalRepository {
  private stopped = false;
  private running = false;
  private wake: (() => void) | undefined;

  constructor(private readonly pool: DatabasePool, private readonly logger: Logger, private readonly intervalMs = 600_000) {}

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  private async nextSource() {
    const result = await this.pool.query(`SELECT i.source_key,i.content_hash
      FROM historical_csv_imports i
      LEFT JOIN prediction_stage_historical_refreshes r ON r.source_key=i.source_key
      WHERE i.status='COMPLETED' AND i.content_hash IS NOT NULL
        AND (r.source_key IS NULL OR r.status<>'COMPLETED' OR r.source_content_hash IS DISTINCT FROM i.content_hash)
      ORDER BY i.season DESC,i.competition,i.source_key LIMIT 1`);
    return result.rows[0] as { source_key: string; content_hash: string } | undefined;
  }

  async refreshSource(sourceKey: string, contentHash: string) {
    await this.pool.query(`INSERT INTO prediction_stage_historical_refreshes(source_key,source_content_hash,status,started_at,updated_at)
      VALUES($1,$2,'RUNNING',now(),now())
      ON CONFLICT(source_key) DO UPDATE SET source_content_hash=excluded.source_content_hash,status='RUNNING',
        matches_inspected=0,examples_inserted=0,research_eligible_examples=0,last_error=NULL,
        started_at=now(),completed_at=NULL,updated_at=now()`,[sourceKey,contentHash]);
    try {
      const rows = await this.pool.query(`SELECT m.id match_id,m.league_id competition_id,m.kickoff_at,m.status,
        m.home_score,m.away_score,h.home_corners,h.away_corners,
        COALESCE(jsonb_agg(jsonb_build_object(
          'bookmaker',o.bookmaker,'market_type',o.market_type,'market_name',o.market_name,'line',o.line,
          'selection',o.selection,'odds_decimal',o.odds_decimal,'observation_stage',o.observation_stage,
          'source_row_hash',o.source_row_hash
        ) ORDER BY o.bookmaker,o.market_type,o.market_name,o.line,o.observation_stage,o.selection,o.id)
        FILTER(WHERE o.id IS NOT NULL),'[]'::jsonb) odds
        FROM matches m JOIN historical_market_odds o ON o.match_id=m.id AND o.source_key=$1 AND o.pre_kickoff_verified=true
        LEFT JOIN historical_match_stats h ON h.match_id=m.id
        WHERE m.status IN('finished','cancelled')
        GROUP BY m.id,h.home_corners,h.away_corners ORDER BY m.kickoff_at,m.id`,[sourceKey]);

      const client = await this.pool.connect();
      let inserted = 0;
      let eligible = 0;
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM prediction_stage_historical_examples WHERE source_key=$1',[sourceKey]);
        for (const row of rows.rows) {
          const drafts = buildStageHistoricalExamples({
            matchId:String(row.match_id),competitionId:String(row.competition_id),kickoffAt:new Date(row.kickoff_at),
            sourceKey,status:String(row.status),
            homeScore:row.home_score==null?null:Number(row.home_score),awayScore:row.away_score==null?null:Number(row.away_score),
            homeCorners:row.home_corners==null?null:Number(row.home_corners),
            awayCorners:row.away_corners==null?null:Number(row.away_corners),
            odds:(row.odds as ArchivedStageOddRow[]) ?? [],
          });
          for (const item of drafts) {
            const result = await client.query(`INSERT INTO prediction_stage_historical_examples(
              match_id,competition_id,kickoff_at,source_key,odds_input_hash,research_eligible,bookmaker_count,
              market_type,market_name,line,selection,opening_odds,closing_odds,opening_fair_probability,
              closing_fair_probability,probability_delta_pp,movement_agreement_ratio,movement_class,
              settlement_result,home_score,away_score,home_corners,away_corners)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
              ON CONFLICT DO NOTHING`,
            [row.match_id,row.competition_id,row.kickoff_at,sourceKey,item.oddsInputHash,item.researchEligible,item.bookmakerCount,
              item.marketType,item.marketName,item.line,item.selection,item.openingOdds,item.closingOdds,
              item.openingFairProbability,item.closingFairProbability,item.probabilityDeltaPp,item.movementAgreementRatio,
              item.movementClass,item.settlementResult,row.home_score,row.away_score,row.home_corners,row.away_corners]);
            inserted += result.rowCount ?? 0;
            if ((result.rowCount ?? 0) > 0 && item.researchEligible) eligible += 1;
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      await this.pool.query(`UPDATE prediction_stage_historical_refreshes SET status='COMPLETED',
        matches_inspected=$2,examples_inserted=$3,research_eligible_examples=$4,completed_at=now(),updated_at=now()
        WHERE source_key=$1`,[sourceKey,rows.rows.length,inserted,eligible]);
      const result={state:'REFRESHED' as const,sourceKey,matchesInspected:rows.rows.length,examplesInserted:inserted,researchEligibleExamples:eligible};
      this.logger.info(result,'CSV stage shadow evidence refreshed');
      return result;
    } catch (error) {
      await this.pool.query(`UPDATE prediction_stage_historical_refreshes SET status='FAILED',last_error=$2,
        completed_at=now(),updated_at=now() WHERE source_key=$1`,
      [sourceKey,(error instanceof Error?error.message:String(error)).slice(0,2000)]).catch(()=>undefined);
      throw error;
    }
  }

  async runNext() {
    if (this.running) return {state:'IN_PROGRESS' as const};
    this.running=true;
    try {
      const source=await this.nextSource();
      if (!source) return {state:'COMPLETE' as const};
      return await this.refreshSource(source.source_key,source.content_hash);
    } finally {
      this.running=false;
    }
  }

  private async wait() {
    await new Promise<void>((resolve)=>{
      const finish=()=>{clearTimeout(timer);this.wake=undefined;resolve();};
      const timer=setTimeout(finish,this.intervalMs);
      this.wake=finish;
    });
  }

  async runForever() {
    while (!this.stopped) {
      try {
        const result=await this.runNext();
        if (result.state==='COMPLETE') return;
      } catch (error) {
        this.logger.warn({err:error},'CSV stage shadow evidence refresh failed; continuing');
      }
      if (!this.stopped) await this.wait();
    }
  }
}
