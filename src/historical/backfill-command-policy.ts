export function enforceReconciliationOnlyMode(input:{dryRun:boolean;execute:boolean;dataBackfillEnabled:boolean}){
  if(!input.dryRun)throw new Error('This command is reconciliation-only; pass --dry-run and never imports data.');
  if(input.execute&&!input.dataBackfillEnabled)throw new Error('DATA_BACKFILL_ENABLED=true is required for --execute.');
  if(input.execute)throw new Error('IMPORT_DISABLED_RECONCILIATION_ONLY: production import is not implemented by this command.');
}

export function productionDatabaseUnavailable(source:ReadonlyArray<{competition:string;discovered:number;eligible:number;invalid:number;
  seasons:ReadonlyArray<Record<string,unknown>>}>){
  return {status:'PRODUCTION_DB_UNAVAILABLE',production_before:null,
    source_summary:{source_candidates:source.reduce((sum,row)=>sum+row.discovered,0),
      eligible:source.reduce((sum,row)=>sum+row.eligible,0),invalid:source.reduce((sum,row)=>sum+row.invalid,0)},
    competition_summary:source.map(row=>({competition:row.competition,source_candidates:row.discovered,eligible:row.eligible,
      existing_duplicate:null,new_insertable:null,ambiguous:null,invalid:row.invalid,
      seasons:row.seasons.map(season=>({...Object.fromEntries(Object.entries(season).filter(([key])=>key!=='eligibleMatches')),
        existing_duplicate:null,new_insertable:null,ambiguous:null}))})),
    duplicate_summary:{existing_duplicate:null,new_insertable:null,ambiguous:null},ambiguous_matches:null,
    safety_checks:{transactionReadOnly:true,queryAttempted:false,writeOperations:0},errorCode:'PRODUCTION_DB_UNAVAILABLE'};
}
