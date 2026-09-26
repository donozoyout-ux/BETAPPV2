import type { AppConfig } from '../config.js';
import type { NowgoalLiveOddsRepository } from '../db/nowgoal-live-odds-repository.js';
import type { Logger } from '../logger.js';
import { nowgoalLiveErrorStatus, NowgoalLiveOddsProvider } from '../providers/nowgoal-live-odds.js';
import { GoogleLiveOddsSheetSync } from '../sheets/nowgoal-live-odds.js';

export class NowgoalLiveOddsCollector {
  private stopped=false;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private lastSheetSyncAt=0;
  private running=false;
  constructor(private readonly config:AppConfig,private readonly provider:NowgoalLiveOddsProvider,
    private readonly repository:NowgoalLiveOddsRepository,private readonly sheets:GoogleLiveOddsSheetSync,private readonly logger:Logger) {}
  stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
  async runCycle(){
    if(this.running)return {configured:false,tracked:0,captured:0,newObservations:0,blocked:0,failures:0,sheet:{status:'SYNC_DISABLED' as const,appended:0}};
    this.running=true;
    try {
    if(!this.config.NOWGOAL_LIVE_ODDS_ENABLED)return;
    const {configured,matches}=await this.repository.trackingCandidates(this.config);
    if(!configured){this.logger.info({status:'NOT_CONFIGURED'},'Live odds collector requires prediction_runs');}
    let inserted=0;let captured=0;let blocked=0;let failures=0;
    for(const match of matches){
      if(this.stopped)break;
      try{
        const result=await this.provider.getHistory(match.nowgoalMatchId);
        inserted+=await this.repository.saveObservations(match.matchId,result.observations);
        if(match.status==='finished')await this.repository.markFinishedCapture(match.matchId,result.observations.length?'AVAILABLE':'NO_DATA');
        captured++;
      }catch(error){
        const status=nowgoalLiveErrorStatus(error);if(status==='BLOCKED')blocked++;else failures++;
        await this.repository.markCaptureFailure(match.matchId,status,error);
        this.logger.warn({matchId:match.matchId,nowgoalMatchId:match.nowgoalMatchId,status,error:error instanceof Error?error.message:String(error)},
          status==='BLOCKED'?'LIVE_ODDS_SOURCE_BLOCKED':'Nowgoal live odds capture failed');
      }
    }
    let sheet:{status:'SYNCED'|'SYNC_DISABLED'|'SYNC_ERROR';appended:number;error?:string}={status:'SYNC_DISABLED',appended:0};
    if(Date.now()-this.lastSheetSyncAt>=this.config.GOOGLE_SHEETS_SYNC_MINUTES*60_000){
      try { sheet=await this.sheets.sync(); }
      catch(error){ this.logger.warn({err:error},'Google Sheets sync failed; Nowgoal data is retained in PostgreSQL'); }
      this.lastSheetSyncAt=Date.now();
    }
    this.logger.info({configured,tracked:matches.length,captured,newObservations:inserted,blocked,failures,sheet:sheet.status,sheetRows:sheet.appended},
      'Nowgoal live odds cycle completed');
    return {configured,tracked:matches.length,captured,newObservations:inserted,blocked,failures,sheet};
    } finally { this.running=false; }
  }
  async runForever(){
    while(!this.stopped){
      try{await this.runCycle();}catch(error){this.logger.error({err:error},'Live odds cycle failed; worker remains alive');}
      if(!this.stopped)await new Promise<void>((resolve)=>{this.timer=setTimeout(()=>{this.timer=undefined;resolve();},
        this.config.NOWGOAL_LIVE_ODDS_INTERVAL_SECONDS*1000);});
    }
  }
}
