import type { DatabasePool } from '../db/pool.js';
import type { HistoricalArchivedOdd } from './public-csv-parser.js';
import type { PublicCsvDataset } from './public-csv-source.js';

export type PublicCsvImportState = {
  source_key: string;
  source_name: string;
  competition: string;
  season: string;
  source_url: string;
  content_hash: string | null;
  status: 'PENDING' | 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED';
  total_rows: number;
  valid_rows: number;
  imported_rows: number;
  matches_inserted: number;
  matches_updated: number;
  duplicates_prevented: number;
  statistics_rows: number;
  odds_rows: number;
  cursor_row: number;
  last_error: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

export class PublicCsvImportRepository {
  constructor(private readonly pool: DatabasePool) {}

  async ensureDatasets(datasets: readonly PublicCsvDataset[]) {
    for (const dataset of datasets) {
      await this.pool.query(`INSERT INTO historical_csv_imports(source_key,source_name,competition,season,source_url,status)
        VALUES($1,'football-data.co.uk',$2,$3,$4,'PENDING')
        ON CONFLICT(source_key) DO UPDATE SET source_url=excluded.source_url,updated_at=now()`,
      [dataset.sourceKey,dataset.competition,dataset.seasonLabel,dataset.url]);
    }
  }

  async state(sourceKey: string): Promise<PublicCsvImportState | null> {
    const result=await this.pool.query<PublicCsvImportState>(
      'SELECT * FROM historical_csv_imports WHERE source_key=$1',[sourceKey]);
    return result.rows[0] ?? null;
  }

  async resetForChangedContent(sourceKey: string) {
    await this.pool.query(`UPDATE historical_csv_imports SET status='PENDING',content_hash=NULL,total_rows=0,valid_rows=0,
      imported_rows=0,matches_inserted=0,matches_updated=0,duplicates_prevented=0,statistics_rows=0,odds_rows=0,
      cursor_row=0,last_error=NULL,started_at=NULL,completed_at=NULL,updated_at=now() WHERE source_key=$1`,[sourceKey]);
  }

  async markRunning(dataset: PublicCsvDataset, contentHash: string, totalRows: number, validRows: number) {
    await this.pool.query(`INSERT INTO historical_csv_imports(source_key,source_name,competition,season,source_url,content_hash,
      status,total_rows,valid_rows,started_at,updated_at)
      VALUES($1,'football-data.co.uk',$2,$3,$4,$5,'RUNNING',$6,$7,now(),now())
      ON CONFLICT(source_key) DO UPDATE SET source_url=excluded.source_url,content_hash=excluded.content_hash,
        status='RUNNING',total_rows=excluded.total_rows,valid_rows=excluded.valid_rows,
        started_at=COALESCE(historical_csv_imports.started_at,now()),last_error=NULL,updated_at=now()`,
    [dataset.sourceKey,dataset.competition,dataset.seasonLabel,dataset.url,contentHash,totalRows,validRows]);
  }

  async markProgress(sourceKey: string, input: {
    cursorRow: number; importedRows: number; matchesInserted: number; matchesUpdated: number;
    duplicatesPrevented: number; statisticsRows: number; oddsRows: number;
  }) {
    await this.pool.query(`UPDATE historical_csv_imports SET status='PARTIAL',cursor_row=$2,imported_rows=imported_rows+$3,
      matches_inserted=matches_inserted+$4,matches_updated=matches_updated+$5,
      duplicates_prevented=duplicates_prevented+$6,statistics_rows=statistics_rows+$7,odds_rows=odds_rows+$8,
      last_error=NULL,updated_at=now() WHERE source_key=$1`,
    [sourceKey,input.cursorRow,input.importedRows,input.matchesInserted,input.matchesUpdated,input.duplicatesPrevented,
      input.statisticsRows,input.oddsRows]);
  }

  async markCompleted(sourceKey: string) {
    await this.pool.query(`UPDATE historical_csv_imports SET status='COMPLETED',cursor_row=valid_rows,
      completed_at=now(),last_error=NULL,updated_at=now() WHERE source_key=$1`,[sourceKey]);
  }

  async markFailed(sourceKey: string, error: unknown) {
    const message=(error instanceof Error ? error.message : String(error)).slice(0,2000);
    await this.pool.query(`UPDATE historical_csv_imports SET status='FAILED',last_error=$2,updated_at=now()
      WHERE source_key=$1`,[sourceKey,message]);
  }

  async saveArchivedOdds(matchId: string, sourceKey: string, rowHash: string, odds: readonly HistoricalArchivedOdd[]) {
    let inserted=0;
    for (const item of odds) {
      const result=await this.pool.query(`INSERT INTO historical_market_odds(match_id,source,source_key,bookmaker,market_type,
        market_name,line,selection,odds_decimal,observation_stage,observed_at,pre_kickoff_verified,source_row_hash)
        VALUES($1,'football-data.co.uk',$2,$3,$4,$5,$6,$7,$8,$9,NULL,true,$10)
        ON CONFLICT DO NOTHING`,
      [matchId,sourceKey,item.bookmaker,item.marketType,item.marketName,item.line,item.selection,item.oddsDecimal,
        item.observationStage,rowHash]);
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }

  async report(limit=50) {
    const safe=Math.max(1,Math.min(200,Math.trunc(limit)));
    return (await this.pool.query(`SELECT source_key,source_name,competition,season,status,total_rows,valid_rows,imported_rows,
      matches_inserted,matches_updated,duplicates_prevented,statistics_rows,odds_rows,cursor_row,last_error,
      started_at,completed_at,updated_at FROM historical_csv_imports ORDER BY season DESC,competition LIMIT $1`,[safe])).rows;
  }
}
