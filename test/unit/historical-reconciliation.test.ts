import {describe,expect,it,vi} from 'vitest';
import {reconcileHistoricalBackfill} from '../../src/historical/reconciliation.js';
import type {BackfillCompetitionResult} from '../../src/historical/data-backfill-dry-run.js';
import {enforceReconciliationOnlyMode,productionDatabaseUnavailable} from '../../src/historical/backfill-command-policy.js';

const candidate=(overrides:Partial<BackfillCompetitionResult['seasons'][number]['eligibleMatches'][number]>={})=>({
  providerExternalId:'of-hash-1',competition:'Premier League',season:'2024/2025',homeTeam:'Arsenal FC',awayTeam:'Chelsea FC',
  kickoffAt:'2025-02-01T15:00:00.000Z',...overrides});
const report=(matches=[candidate()]):BackfillCompetitionResult=>({competition:'Premier League',targetFinishedMatches:80,
  discovered:1,eligible:matches.length,inserted:0,imported:0,duplicate:null,ambiguous:null,new_insertable:null,invalid:0,
  skipped:0,unsafe_time:0,future:0,before_cutoff:0,invalid_result:0,errors:0,seasons:[{source:'OpenFootball CC0',
    competition:'Premier League',season:'2024-25',url:'https://example.test',discovered:1,eligible:matches.length,
    inserted:0,imported:0,duplicate:null,ambiguous:null,new_insertable:null,invalid:0,skipped:0,unsafe_time:0,
    future:0,before_cutoff:0,invalid_result:0,errors:0,databaseDuplicateEstimate:'NOT_CHECKED',eligibleMatches:matches}]});
const existing=(overrides:Record<string,unknown>={})=>({competition:'Premier League',season:'2024/2025',home_team:'Arsenal',
  away_team:'Chelsea',kickoff_at:'2025-02-01T15:00:00.000Z',provider:null,external_id:null,...overrides});

function pool(rows:unknown[]){
  const calls:string[]=[];
  const client={query:vi.fn(async(sql:string)=>{calls.push(sql);
    if(sql.includes('SELECT count(*)::int total_matches'))return {rows:[{total_matches:367,finished:144}]} as never;
    if(sql.includes('SELECT l.name competition,count(m.id)'))return {rows:[{competition:'Premier League',total_matches:44,finished:30}]} as never;
    if(sql.includes('SELECT l.name competition,m.season'))return {rows} as never;
    return {rows:[]} as never;
  }),release:vi.fn()};
  return {pool:{connect:vi.fn(async()=>client)} as never,client,calls};
}

describe('read-only historical reconciliation',()=>{
  it('reports production DB unavailable without assuming zero duplicates or insertables',()=>{
    const result=productionDatabaseUnavailable([report()]);
    expect(result).toMatchObject({status:'PRODUCTION_DB_UNAVAILABLE',production_before:null,
      duplicate_summary:{existing_duplicate:null,new_insertable:null,ambiguous:null}});
    expect(result.source_summary).toEqual({source_candidates:1,eligible:1,invalid:0});
  });

  it('requires dry-run mode and blocks execute unless enabled, then still stays reconciliation-only',()=>{
    expect(()=>enforceReconciliationOnlyMode({dryRun:false,execute:false,dataBackfillEnabled:false}))
      .toThrow('pass --dry-run');
    expect(()=>enforceReconciliationOnlyMode({dryRun:true,execute:true,dataBackfillEnabled:false}))
      .toThrow('DATA_BACKFILL_ENABLED=true');
    expect(()=>enforceReconciliationOnlyMode({dryRun:true,execute:true,dataBackfillEnabled:true}))
      .toThrow('IMPORT_DISABLED_RECONCILIATION_ONLY');
    expect(()=>enforceReconciliationOnlyMode({dryRun:true,execute:false,dataBackfillEnabled:false})).not.toThrow();
  });

  it('recognizes exact provider/source identity before canonical matching',async()=>{
    const h=pool([existing({provider:'openfootball',external_id:'of-hash-1',home_team:'Wrong',away_team:'Names'})]);
    const result=await reconcileHistoricalBackfill(h.pool,[report()]);
    expect(result.duplicate_summary).toMatchObject({existing_duplicate:1,new_insertable:0,ambiguous:0});
  });

  it('matches canonical competition, normalized teams, season and exact kickoff',async()=>{
    const h=pool([existing()]);const result=await reconcileHistoricalBackfill(h.pool,[report()]);
    expect(result.duplicate_summary).toMatchObject({existing_duplicate:1,new_insertable:0});
  });

  it('does not mark same teams at a different kickoff as duplicate',async()=>{
    const h=pool([existing({kickoff_at:'2025-02-08T15:00:00.000Z'})]);
    const result=await reconcileHistoricalBackfill(h.pool,[report()]);
    expect(result.duplicate_summary).toMatchObject({existing_duplicate:0,new_insertable:1,ambiguous:0});
  });

  it('does not mark different teams at the same kickoff as duplicate',async()=>{
    const h=pool([existing({home_team:'Manchester City',away_team:'Liverpool'})]);
    const result=await reconcileHistoricalBackfill(h.pool,[report()]);
    expect(result.duplicate_summary).toMatchObject({existing_duplicate:0,new_insertable:1,ambiguous:0});
  });

  it('marks exact team and kickoff with conflicting season metadata ambiguous',async()=>{
    const h=pool([existing({season:null})]);
    const result=await reconcileHistoricalBackfill(h.pool,[report()]);
    expect(result.duplicate_summary).toMatchObject({existing_duplicate:0,new_insertable:0,ambiguous:1});
    expect(result.ambiguous_matches[0]).toMatchObject({reason:'COMPETITION_SEASON_CONFLICT'});
  });

  it('surfaces near-time fuzzy team candidates as ambiguous, never duplicate',async()=>{
    const h=pool([existing({home_team:'Arsenl FC',kickoff_at:'2025-02-01T15:10:00.000Z'})]);
    const result=await reconcileHistoricalBackfill(h.pool,[report()]);
    expect(result.duplicate_summary).toMatchObject({existing_duplicate:0,new_insertable:0,ambiguous:1});
    expect(result.ambiguous_matches).toHaveLength(1);
  });

  it('reclassifies an imported source identity as duplicate on reconciliation rerun',async()=>{
    const first=pool([]);const initial=await reconcileHistoricalBackfill(first.pool,[report()]);
    expect(initial.duplicate_summary).toMatchObject({new_insertable:1});
    const rerun=pool([existing({provider:'openfootball',external_id:'of-hash-1'})]);
    const afterImport=await reconcileHistoricalBackfill(rerun.pool,[report()]);
    expect(afterImport.duplicate_summary).toMatchObject({existing_duplicate:1,new_insertable:0});
  });

  it('uses a read-only transaction and sends SELECT statements only',async()=>{
    const h=pool([existing()]);const result=await reconcileHistoricalBackfill(h.pool,[report()]);
    expect(h.calls).toContain('BEGIN');expect(h.calls).toContain('SET TRANSACTION READ ONLY');expect(h.calls).toContain('COMMIT');
    expect(h.calls.every(sql=>!(/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)))).toBe(true);
    expect(result).toMatchObject({production_before:{total_matches:367,finished:144},
      safety_checks:{transactionReadOnly:true,insertUpdateDelete:0,oddsPredictionTablesTouched:false}});
  });
});
