import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { migrationStatus,runMigrations } from '../../src/db/migrator.js';
import { createPool,type DatabasePool } from '../../src/db/pool.js';
import { NowgoalLiveOddsRepository } from '../../src/db/nowgoal-live-odds-repository.js';
import { parseNowgoalLiveOdds } from '../../src/providers/nowgoal-live-odds.js';
import type { AppConfig } from '../../src/config.js';
import { isCompetitionConfigured } from '../../src/matching/competition.js';

// Deterministic parser fixture used only in this isolated integration database.
function fixturePayload(minute:string,home:string,away:string){
  const row=Array.from({length:40},()=> '');row[0]=minute;row[1]=home;row[2]=away;
  for(const offset of [3,6,9,12])row.splice(offset,3,'0.95','0','0.85');
  for(const offset of [15,18,21,24])row.splice(offset,3,'0.85','1','0.95');
  for(const offset of [27,30,33,36])row.splice(offset,3,'3.25','2.20','3.10');row[39]='3';
  return {ErrCode:0,Data:'2993801,8,TEST FIXTURE BOOK#'+row.join(',')};
}

describe('Nowgoal live odds PostgreSQL integration',()=>{
  let container:Awaited<ReturnType<PostgreSqlContainer['start']>>|undefined;
  let pool:DatabasePool;
  let repository:NowgoalLiveOddsRepository;
  const matches=new Map<string,string>();
  const config={SUPPORTED_COMPETITIONS:['PremierLeague']} as unknown as AppConfig;
  const source='https://live11.nowgoal26.com/match/live-2993801';

  beforeAll(async()=>{
    container=await new PostgreSqlContainer('postgres:16-alpine').start();
    pool=createPool({DATABASE_URL:container.getConnectionUri(),DATABASE_SSL:false});
    await runMigrations(pool);repository=new NowgoalLiveOddsRepository(pool);
    for(const [key,status,kickoff] of [
      ['eligible','scheduled',new Date(Date.now()-60_000)],['not-analyzed','scheduled',new Date(Date.now()-60_000)],
      ['finished','finished',new Date(Date.now()-3_600_000)],['unsupported','scheduled',new Date(Date.now()-60_000)],
      ['future','scheduled',new Date(Date.now()+3_600_000)],['skip','scheduled',new Date(Date.now()-60_000)],
      ['nonnumeric','scheduled',new Date(Date.now()-60_000)],
    ] as const){
      const league=(await pool.query<{id:string}>(`INSERT INTO leagues(name,country) VALUES($1,'Test') RETURNING id`,
        [key==='unsupported'?'Unsupported League':'Premier League'])).rows[0]!.id;
      const home=(await pool.query<{id:string}>(`INSERT INTO teams(name) VALUES($1) RETURNING id`,[key+' home'])).rows[0]!.id;
      const away=(await pool.query<{id:string}>(`INSERT INTO teams(name) VALUES($1) RETURNING id`,[key+' away'])).rows[0]!.id;
      const matchId=(await pool.query<{id:string}>(`INSERT INTO matches(league_id,home_team_id,away_team_id,kickoff_at,status,source_updated_at)
        VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,[league,home,away,kickoff,status])).rows[0]!.id;
      matches.set(key,matchId);
      const externalId=key==='nonnumeric'?'ng-x':String(2993801+matches.size);
      await pool.query(`INSERT INTO provider_entities(provider,entity_type,external_id,internal_id,source_updated_at)
        VALUES('nowgoal','match',$1,$2,now())`,[externalId,matchId]);
      await pool.query(`INSERT INTO odds_snapshots(match_id,provider,provider_match_id,market_type,market_name,selection,odds_decimal,captured_at)
        VALUES($1,'nowgoal:8',$2,'MATCH_RESULT','1X2','HOME',2.25,now())`,[matchId,externalId]);
      await pool.query(`INSERT INTO prediction_model_versions(model_version,config_hash,config)
        VALUES($1,'TEST','{}') ON CONFLICT DO NOTHING`,[key]);
      if(key!=='not-analyzed')await pool.query(`INSERT INTO prediction_runs(match_id,model_version,config_hash,input_hash,odds_analysis_input_hash,generated_at,decision)
        VALUES($1,$2,'TEST',$3,'fixture',now(),$4)`,[matchId,key,key,key==='skip'?'SKIP':'PREDICT']);
    }
    const nonnumericId=matches.get('nonnumeric')!;
    await pool.query(`UPDATE provider_entities SET external_id='ng-nonnumeric' WHERE provider='nowgoal' AND internal_id=$1`,[nonnumericId]);
    await pool.query(`UPDATE odds_snapshots SET provider_match_id='ng-nonnumeric' WHERE match_id=$1`,[nonnumericId]);
  });

  afterAll(async()=>{await pool?.end();await container?.stop();});

  it('applies migration 019 and creates both live odds tables while retaining prediction_runs',async()=>{
    const status=await migrationStatus(pool);
    expect(status.pendingMigrations).toEqual([]);
    expect(status.currentMigrations.map((item)=>item.version)).toContain('019_nowgoal_live_odds_analysis_v1.sql');
    const tables=await pool.query<{snapshots:string|null;tracking:string|null;predictions:string|null}>(
      `SELECT to_regclass('nowgoal_live_odds_snapshots')::text snapshots,
        to_regclass('nowgoal_live_match_tracking')::text tracking,to_regclass('prediction_runs')::text predictions`);
    expect(tables.rows[0]).toEqual({snapshots:'nowgoal_live_odds_snapshots',tracking:'nowgoal_live_match_tracking',predictions:'prediction_runs'});
  });

  it('limits candidates to PREDICT, supported, kickoff-past, numeric-provider, unfinished-final-capture matches',async()=>{
    const result=await repository.trackingCandidates(config);
    expect(result.configured).toBe(true);
    expect(result.matches.map((item)=>item.matchId)).toContain(matches.get('eligible'));
    expect(result.matches.map((item)=>item.matchId)).toContain(matches.get('finished'));
    for(const key of ['not-analyzed','unsupported','future','skip'])expect(result.matches.map((item)=>item.matchId)).not.toContain(matches.get(key));
    expect(result.matches.map((item)=>item.matchId)).not.toContain(matches.get('nonnumeric'));
    expect(isCompetitionConfigured('Premier League',['PremierLeague'])).toBe(true);
    expect(isCompetitionConfigured('Unsupported League',['PremierLeague'])).toBe(false);
  });

  it('persists parser-fixture observations, deduplicates unchanged identity, and inserts changed identity',async()=>{
    const matchId=matches.get('eligible')!;
    const parse=(minute:string,home:string,away:string)=>parseNowgoalLiveOdds(fixturePayload(minute,home,away),
      {sourceUrl:source,capturedAt:new Date(),nowgoalMatchId:'2993801'});
    const first=parse('45','0','0');
    const inserted=await repository.saveObservations(matchId,first);
    expect(inserted).toBe(2);
    expect(await repository.saveObservations(matchId,first)).toBe(0);
    expect(await repository.saveObservations(matchId,parse('46','0','0'))).toBe(2);
    expect(await repository.saveObservations(matchId,parse('46','1','0'))).toBe(2);
    const count=await pool.query<{count:string}>('SELECT count(*) count FROM nowgoal_live_odds_snapshots WHERE match_id=$1',[matchId]);
    expect(Number(count.rows[0]?.count)).toBe(6);
  });

  it('only finalizes a finished match after nonempty source data; empty and errors stay retryable',async()=>{
    const matchId=matches.get('finished')!;
    await repository.markSourceSuccessNoData(matchId);
    expect((await repository.trackingCandidates(config)).matches.map((item)=>item.matchId)).toContain(matchId);
    await repository.markCaptureFailure(matchId,'SOURCE_BLOCKED',new Error('fixture blocked'));
    expect((await repository.trackingCandidates(config)).matches.map((item)=>item.matchId)).toContain(matchId);
    await repository.saveObservations(matchId,parseNowgoalLiveOdds(fixturePayload('90','1','0'),
      {sourceUrl:source,capturedAt:new Date(),nowgoalMatchId:'2993801'}));
    await repository.markFinishedCapture(matchId);
    const tracking=await pool.query<{finished_final_capture_at:Date|null;last_status:string}>(
      'SELECT finished_final_capture_at,last_status FROM nowgoal_live_match_tracking WHERE match_id=$1',[matchId]);
    expect(tracking.rows[0]).toMatchObject({last_status:'SOURCE_SUCCESS_WITH_DATA',finished_final_capture_at:expect.any(Date)});
    expect((await repository.trackingCandidates(config)).matches.map((item)=>item.matchId)).not.toContain(matchId);
  });

  it('keeps PostgreSQL observations persisted when a Google Sheets mirror fails',async()=>{
    const matchId=matches.get('not-analyzed')!;
    const rows=parseNowgoalLiveOdds(fixturePayload('51','0','0'),{sourceUrl:source,capturedAt:new Date(),nowgoalMatchId:'2993801'});
    const sheets={sync:async()=>({status:'SYNC_ERROR' as const,appended:0,error:'fixture Google failure'})};
    const collector=new (await import('../../src/collector/nowgoal-live-odds-collector.js')).NowgoalLiveOddsCollector(
      {...config,NOWGOAL_LIVE_ODDS_ENABLED:true,GOOGLE_SHEETS_SYNC_MINUTES:5} as AppConfig,
      {getHistory:async()=>({observations:rows})} as never,
      {trackingCandidates:async()=>({configured:true,matches:[{matchId,nowgoalMatchId:'2993801',status:'live',competition:'Premier League',homeTeam:'Home',awayTeam:'Away',kickoffAt:new Date()}]}),
        saveObservations:repository.saveObservations.bind(repository),markSourceSuccessNoData:repository.markSourceSuccessNoData.bind(repository),
        markFinishedCapture:repository.markFinishedCapture.bind(repository),markCaptureFailure:repository.markCaptureFailure.bind(repository)} as never,
      sheets as never,{info:()=>{},warn:()=>{},error:()=>{}} as never);
    await expect(collector.runCycle()).resolves.toMatchObject({sheet:{status:'SYNC_ERROR'}});
    const count=await pool.query<{count:string}>('SELECT count(*) count FROM nowgoal_live_odds_snapshots WHERE match_id=$1',[matchId]);
    expect(Number(count.rows[0]?.count)).toBe(rows.length);
  });
});
