import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { FootballRepository } from '../db/repository.js';
import type { HistoricalRepository } from '../db/historical-repository.js';
import type { Logger } from '../logger.js';
import { parseOpenFootballDataset } from './openfootball-parser.js';
import { OpenFootballImportRepository } from './openfootball-repository.js';
import { currentOpenFootballSeason, openFootballDatasets, type OpenFootballDataset } from './openfootball-source.js';

const FAILURE_COOLDOWN_MS=6*60*60_000;

export class OpenFootballHistoricalImporter {
  private stopped=false;
  private running=false;
  private wake:(()=>void)|undefined;
  private cooldowns=new Map<string,number>();

  constructor(private readonly config:AppConfig,private readonly football:FootballRepository,
    private readonly historical:HistoricalRepository,private readonly imports:OpenFootballImportRepository,
    private readonly logger:Logger) {}

  enabled(){ return this.config.OPENFOOTBALL_IMPORT_ENABLED; }
  stop(){ this.stopped=true; this.wake?.(); }

  private datasets(){
    return openFootballDatasets(this.config.OPENFOOTBALL_BASE_URL,this.config.OPENFOOTBALL_IMPORT_SEASONS,
      this.config.SUPPORTED_COMPETITIONS);
  }

  private async fetchDataset(dataset:OpenFootballDataset){
    const response=await fetch(dataset.url,{headers:{'user-agent':'BETAPPV2/2.0 openfootball-cc0-import'},
      signal:AbortSignal.timeout(this.config.PROVIDER_TIMEOUT_MS)});
    if(!response.ok) throw new Error(`OPENFOOTBALL_HTTP_${response.status}`);
    const text=await response.text();
    return {payload:JSON.parse(text) as unknown,contentHash:createHash('sha256').update(text).digest('hex')};
  }

  private async nextDataset(now=new Date()){
    const datasets=this.datasets();
    await this.imports.ensureDatasets(datasets);
    const current=currentOpenFootballSeason(now);
    let idle=false,waitingRetry=false;
    for(const dataset of datasets){
      const state=await this.imports.state(dataset.sourceKey);
      const cooldown=this.cooldowns.get(dataset.sourceKey)??0;
      if(cooldown>now.getTime()){waitingRetry=true;continue;}
      if(state?.status==='COMPLETED'){
        if(dataset.season!==current) continue;
        idle=true;
        const checked=state.updated_at?new Date(state.updated_at).getTime():0;
        if(now.getTime()-checked<this.config.OPENFOOTBALL_CURRENT_REFRESH_MS) continue;
      }
      return {dataset,state};
    }
    return waitingRetry||idle?{dataset:null,state:null,waitingRetry}:null;
  }

  async runCycle(){
    if(!this.enabled()) return {state:'DISABLED' as const};
    if(this.running) return {state:'IN_PROGRESS' as const};
    this.running=true;
    try{
      const candidate=await this.nextDataset();
      if(!candidate) return {state:'COMPLETE' as const};
      if(!candidate.dataset) return candidate.waitingRetry?{state:'WAITING_RETRY' as const}:{state:'IDLE' as const};
      const {dataset}=candidate;
      try{
        const fetchedAt=new Date();
        const fetched=await this.fetchDataset(dataset);
        let state=candidate.state;
        if(state?.status==='COMPLETED'&&state.content_hash===fetched.contentHash){
          await this.imports.checked(dataset.sourceKey);
          return {state:'NO_CHANGE' as const,sourceKey:dataset.sourceKey};
        }
        if(state?.content_hash&&state.content_hash!==fetched.contentHash){
          await this.imports.reset(dataset.sourceKey);
          state=await this.imports.state(dataset.sourceKey);
        }
        const parsed=parseOpenFootballDataset(fetched.payload,dataset,fetchedAt);
        await this.imports.markRunning(dataset,fetched.contentHash,{
          total:parsed.totalMatches,finished:parsed.finishedRows,unfinished:parsed.skippedUnfinished,unsafe:parsed.skippedUnsafeTime,
        });
        state=await this.imports.state(dataset.sourceKey);
        const start=Math.max(0,Number(state?.cursor_row??0));
        if(start>=parsed.matches.length){
          await this.imports.complete(dataset.sourceKey);
          return {state:'DATASET_COMPLETED' as const,sourceKey:dataset.sourceKey,imported:0};
        }
        const batch=parsed.matches.slice(start,start+this.config.OPENFOOTBALL_BATCH_SIZE);
        let imported=0,inserted=0,updated=0,duplicates=0;
        for(const item of batch){
          if(this.stopped) break;
          const outcome={matchesInserted:0,matchesUpdated:0,teamsCreated:0,duplicateMatchesPrevented:0};
          await this.football.upsertMatch('openfootball',item.match,outcome);
          await this.historical.save('openfootball',item.match,item.statistics,fetchedAt,null,true);
          imported+=1; inserted+=outcome.matchesInserted; updated+=outcome.matchesUpdated; duplicates+=outcome.duplicateMatchesPrevented;
        }
        const cursor=start+imported;
        await this.imports.markProgress(dataset.sourceKey,{cursor,imported,inserted,updated,duplicates});
        if(cursor>=parsed.matches.length) await this.imports.complete(dataset.sourceKey);
        this.cooldowns.delete(dataset.sourceKey);
        const result={state:cursor>=parsed.matches.length?'DATASET_COMPLETED' as const:'BATCH_IMPORTED' as const,
          sourceKey:dataset.sourceKey,competition:dataset.competition,season:dataset.season,cursor,finishedRows:parsed.finishedRows,
          imported,inserted,updated,duplicates,skippedUnfinished:parsed.skippedUnfinished,skippedUnsafeTime:parsed.skippedUnsafeTime};
        this.logger.info(result,'OpenFootball CC0 historical import cycle completed');
        return result;
      }catch(error){
        await this.imports.fail(dataset.sourceKey,error).catch(()=>undefined);
        this.cooldowns.set(dataset.sourceKey,Date.now()+FAILURE_COOLDOWN_MS);
        this.logger.warn({err:error,sourceKey:dataset.sourceKey},'OpenFootball dataset failed; continuing later');
        return {state:'ERROR' as const,sourceKey:dataset.sourceKey,error:error instanceof Error?error.message:String(error)};
      }
    }finally{this.running=false;}
  }

  private async wait(){ await new Promise<void>((resolve)=>{
    const finish=()=>{clearTimeout(timer);this.wake=undefined;resolve();};
    const timer=setTimeout(finish,this.config.OPENFOOTBALL_INTERVAL_MS);this.wake=finish;
  });}

  async runForever(){
    if(!this.enabled()) return;
    while(!this.stopped){
      await this.runCycle();
      if(!this.stopped) await this.wait();
    }
  }
}
