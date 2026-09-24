import type { DatabasePool } from '../db/pool.js';
import type { OpenFootballDataset } from './openfootball-source.js';

export class OpenFootballImportRepository {
  constructor(private readonly pool: DatabasePool) {}

  async ensureDatasets(datasets: readonly OpenFootballDataset[]) {
    for (const d of datasets) await this.pool.query(`INSERT INTO openfootball_imports(source_key,competition,season,source_url,status)
      VALUES($1,$2,$3,$4,'PENDING') ON CONFLICT(source_key) DO UPDATE SET source_url=excluded.source_url`,
    [d.sourceKey,d.competition,d.season,d.url]);
  }

  async state(sourceKey:string) {
    return (await this.pool.query('SELECT * FROM openfootball_imports WHERE source_key=$1',[sourceKey])).rows[0] ?? null;
  }

  async reset(sourceKey:string) {
    await this.pool.query(`UPDATE openfootball_imports SET status='PENDING',content_hash=NULL,total_matches=0,finished_rows=0,
      imported_rows=0,matches_inserted=0,matches_updated=0,duplicates_prevented=0,result_rows=0,
      skipped_unfinished=0,skipped_unsafe_time=0,cursor_row=0,last_error=NULL,started_at=NULL,completed_at=NULL,updated_at=now()
      WHERE source_key=$1`,[sourceKey]);
  }

  async markRunning(d:OpenFootballDataset,hash:string,meta:{total:number;finished:number;unfinished:number;unsafe:number}) {
    await this.pool.query(`UPDATE openfootball_imports SET status='RUNNING',content_hash=$2,total_matches=$3,finished_rows=$4,
      skipped_unfinished=$5,skipped_unsafe_time=$6,started_at=COALESCE(started_at,now()),last_error=NULL,updated_at=now()
      WHERE source_key=$1`,[d.sourceKey,hash,meta.total,meta.finished,meta.unfinished,meta.unsafe]);
  }

  async markProgress(sourceKey:string,input:{cursor:number;imported:number;inserted:number;updated:number;duplicates:number}) {
    await this.pool.query(`UPDATE openfootball_imports SET status='PARTIAL',cursor_row=$2,imported_rows=imported_rows+$3,
      matches_inserted=matches_inserted+$4,matches_updated=matches_updated+$5,duplicates_prevented=duplicates_prevented+$6,
      result_rows=result_rows+$3,last_error=NULL,updated_at=now() WHERE source_key=$1`,
    [sourceKey,input.cursor,input.imported,input.inserted,input.updated,input.duplicates]);
  }

  async complete(sourceKey:string) {
    await this.pool.query(`UPDATE openfootball_imports SET status='COMPLETED',cursor_row=finished_rows,completed_at=now(),
      last_error=NULL,updated_at=now() WHERE source_key=$1`,[sourceKey]);
  }

  async checked(sourceKey:string) {
    await this.pool.query('UPDATE openfootball_imports SET updated_at=now(),last_error=NULL WHERE source_key=$1',[sourceKey]);
  }

  async fail(sourceKey:string,error:unknown) {
    await this.pool.query(`UPDATE openfootball_imports SET status='FAILED',last_error=$2,updated_at=now() WHERE source_key=$1`,
    [sourceKey,(error instanceof Error?error.message:String(error)).slice(0,2000)]);
  }
}
