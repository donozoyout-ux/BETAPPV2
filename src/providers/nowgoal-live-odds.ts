import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { check, statusFromError } from '../qualification/helpers.js';
import { providerCapabilities, type ProviderQualification, type QualifiableProvider } from '../qualification/types.js';
import { ProviderHttpError, ResilientHttpClient } from './http-client.js';

export const NOWGOAL_LIVE_PARSER_VERSION = '1';
export type LiveOddsObservation = {
  nowgoalMatchId: string;
  sourceUrl: string;
  capturedAt: Date;
  matchMinute: string | null;
  minuteLabel: string | null;
  scoreText: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  period: string;
  bookmaker: string | null;
  ahInitialHome: number | null; ahInitialLine: number | null; ahInitialAway: number | null;
  ahLiveHome: number | null; ahLiveLine: number | null; ahLiveAway: number | null;
  oneXTwoInitialHome: number | null; oneXTwoInitialDraw: number | null; oneXTwoInitialAway: number | null;
  oneXTwoLiveHome: number | null; oneXTwoLiveDraw: number | null; oneXTwoLiveAway: number | null;
  ouInitialOver: number | null; ouInitialLine: number | null; ouInitialUnder: number | null;
  ouLiveOver: number | null; ouLiveLine: number | null; ouLiveUnder: number | null;
  parserVersion: string; rawHash: string; rawPayload: unknown;
};
export type NowgoalLiveMetadata = { sourceUrl: string; capturedAt?: Date; nowgoalMatchId?: string };
type MarketValues = Pick<LiveOddsObservation,
  'ahInitialHome'|'ahInitialLine'|'ahInitialAway'|'ahLiveHome'|'ahLiveLine'|'ahLiveAway'|
  'oneXTwoInitialHome'|'oneXTwoInitialDraw'|'oneXTwoInitialAway'|'oneXTwoLiveHome'|'oneXTwoLiveDraw'|'oneXTwoLiveAway'|
  'ouInitialOver'|'ouInitialLine'|'ouInitialUnder'|'ouLiveOver'|'ouLiveLine'|'ouLiveUnder'>;

function numeric(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
function odds(value: string | undefined): number | null {
  const parsed = numeric(value);
  return parsed != null && parsed > 0 && parsed <= 1000 ? parsed : null;
}
function marketGroup(row: string[], initial: number, live: number, kind: 'asian'|'ou'|'1x2'): [number|null,number|null,number|null,number|null,number|null,number|null] {
  const a = row.slice(initial, initial + 3); const b = row.slice(live, live + 3);
  const line = (value: string | undefined) => numeric(value);
  return kind === '1x2' ? [odds(a[0]),odds(a[1]),odds(a[2]),odds(b[0]),odds(b[1]),odds(b[2])]
    : [odds(a[0]),line(a[1]),odds(a[2]),odds(b[0]),line(b[1]),odds(b[2])];
}
function nonemptyMarkets(m: MarketValues): boolean {
  return Object.entries(m).some(([key,value]) => !key.endsWith('Line') && value != null);
}

/** Parse Nowgoal's public type=4 structured response, including every company and history row. */
export function parseNowgoalLiveOdds(input: unknown, metadata: NowgoalLiveMetadata): LiveOddsObservation[] {
  if (!input || typeof input !== 'object' || !('Data' in input) || typeof input.Data !== 'string') return [];
  const body = input as { ErrCode?: unknown; Data: string };
  if (body.ErrCode !== 0 && body.ErrCode !== '0') return [];
  const idFromUrl = /\/live-(\d+)(?:[/?#]|$)/.exec(metadata.sourceUrl)?.[1];
  const nowgoalMatchId = metadata.nowgoalMatchId ?? idFromUrl;
  if (!nowgoalMatchId) return [];
  const capturedAt = metadata.capturedAt ?? new Date();
  const observations: LiveOddsObservation[] = [];
  for (const companyBlock of body.Data.split('!')) {
    const split = companyBlock.indexOf('#');
    if (split < 0) continue;
    const [providerId, bookmakerId, bookmakerName] = companyBlock.slice(0, split).split(',');
    if (providerId !== nowgoalMatchId || !bookmakerId) continue;
    const bookmaker = bookmakerName?.trim() || null;
    for (const rawRow of companyBlock.slice(split + 1).split('^')) {
      const row = rawRow.split(',');
      if (row.length < 40) continue;
      const minuteLabel = row[0]?.trim() || null;
      const scoreHome = /^\d+$/.test(row[1] ?? '') ? Number(row[1]) : null;
      const scoreAway = /^\d+$/.test(row[2] ?? '') ? Number(row[2]) : null;
      const matchMinute = minuteLabel && /^\d+(?:\+\d+)?$/.test(minuteLabel) ? minuteLabel : null;
      // The public detail renderer uses h* slots for HT and f* slots for FT.
      for (const [period, ahOffset, ouOffset, oneXTwoOffset] of [['HT',3,15,27],['FT',9,21,33]] as const) {
        const [ahInitialHome,ahInitialLine,ahInitialAway,ahLiveHome,ahLiveLine,ahLiveAway] = marketGroup(row,ahOffset,ahOffset+3,'asian');
        const [oneXTwoInitialHome,oneXTwoInitialDraw,oneXTwoInitialAway,oneXTwoLiveHome,oneXTwoLiveDraw,oneXTwoLiveAway] = marketGroup(row,oneXTwoOffset,oneXTwoOffset+3,'1x2');
        const [ouInitialOver,ouInitialLine,ouInitialUnder,ouLiveOver,ouLiveLine,ouLiveUnder] = marketGroup(row,ouOffset,ouOffset+3,'ou');
        const markets = { ahInitialHome,ahInitialLine,ahInitialAway,ahLiveHome,ahLiveLine,ahLiveAway,
          oneXTwoInitialHome,oneXTwoInitialDraw,oneXTwoInitialAway,oneXTwoLiveHome,oneXTwoLiveDraw,oneXTwoLiveAway,
          ouInitialOver,ouInitialLine,ouInitialUnder,ouLiveOver,ouLiveLine,ouLiveUnder };
        if (!nonemptyMarkets(markets)) continue;
        const rawPayload = { companyId: bookmakerId, bookmaker, row: rawRow };
        const serializedPayload=JSON.stringify(rawPayload);
        const boundedPayload=Buffer.byteLength(serializedPayload)<=40_000?rawPayload:{truncated:true,
          originalBytes:Buffer.byteLength(serializedPayload),payloadSha256:createHash('sha256').update(serializedPayload).digest('hex'),
          preview:serializedPayload.slice(0,8_000)};
        const rawHash = createHash('sha256').update(JSON.stringify(rawPayload)).digest('hex');
        observations.push({ nowgoalMatchId, sourceUrl: metadata.sourceUrl, capturedAt, matchMinute, minuteLabel,
          scoreText:scoreHome==null||scoreAway==null?null:String(scoreHome)+':'+String(scoreAway),
          scoreHome, scoreAway, period, bookmaker, ...markets, parserVersion: NOWGOAL_LIVE_PARSER_VERSION, rawHash, rawPayload:boundedPayload });
      }
    }
  }
  return observations;
}

export class NowgoalLiveOddsProvider implements QualifiableProvider {
  readonly name='nowgoal-live-odds';
  private readonly http: ResilientHttpClient;
  constructor(private readonly config: Pick<AppConfig,'NOWGOAL_LIVE_BASE_URL'|'NOWGOAL_LIVE_SMOKE_MATCH_ID'|'PROVIDER_TIMEOUT_MS'|'PROVIDER_REQUESTS_PER_SECOND'|'PROVIDER_MAX_RETRIES'>, logger: Logger) {
    this.http = new ResilientHttpClient({ baseUrl: new URL(config.NOWGOAL_LIVE_BASE_URL).origin,
      timeoutMs: config.PROVIDER_TIMEOUT_MS, requestsPerSecond: config.PROVIDER_REQUESTS_PER_SECOND,
      maxRetries: config.PROVIDER_MAX_RETRIES, logger });
  }
  async getHistory(nowgoalMatchId: string, capturedAt = new Date()) {
    if (!/^\d+$/.test(nowgoalMatchId)) throw new Error('Invalid Nowgoal ScheduleID');
    const sourceUrl = `${this.config.NOWGOAL_LIVE_BASE_URL}${nowgoalMatchId}`;
    const responseUrl = new URL('/Ajax/SoccerAjax', sourceUrl);
    responseUrl.searchParams.set('type','4'); responseUrl.searchParams.set('id',nowgoalMatchId);
    responseUrl.searchParams.set('p',String(capturedAt.getTime()));
    const payload = await this.http.getJson<unknown>(`${responseUrl.pathname}${responseUrl.search}`);
    if(!payload||typeof payload!=='object'||!('ErrCode' in payload)||!('Data' in payload)||typeof payload.Data!=='string'
      ||(payload.ErrCode!==0&&payload.ErrCode!=='0'))throw new Error('Invalid Nowgoal live odds source response');
    return { sourceUrl, payload, observations: parseNowgoalLiveOdds(payload,{ sourceUrl, capturedAt, nowgoalMatchId }) };
  }
  async qualify(matchId=this.config.NOWGOAL_LIVE_SMOKE_MATCH_ID):Promise<ProviderQualification>{
    const started=Date.now();
    try{
      const result=await this.getHistory(matchId);const rows=result.observations.length;
      const books=new Set(result.observations.map((item)=>item.bookmaker).filter(Boolean));
      const checks=providerCapabilities.map((capability)=>capability==='LIVE_ODDS'
        ? check(capability,rows>0?'SUPPORTED':'UNAVAILABLE',result.sourceUrl,{httpStatus:200,latencyMs:Date.now()-started,
          sampleCount:rows,parseSuccess:rows>0,notes:'Nowgoal type=4 structured endpoint; source-provided bookmakers: '+[...books].join(', ')})
        : check(capability,'NOT_TESTED',result.sourceUrl,{httpStatus:200,latencyMs:Date.now()-started,notes:'Capability outside Live Odds Analysis scope'}));
      return {provider:this.name,connection:rows?'SUPPORTED':'UNAVAILABLE',checks};
    }catch(error){
      const status=statusFromError(error);const blocked=status===403||status===429;
      return {provider:this.name,connection:blocked?'BLOCKED':'UNAVAILABLE',checks:providerCapabilities.map((capability)=>
        check(capability,capability==='LIVE_ODDS'?(blocked?'BLOCKED':'UNAVAILABLE'):'NOT_TESTED',this.config.NOWGOAL_LIVE_BASE_URL,
          {httpStatus:status,latencyMs:Date.now()-started,error:error instanceof Error?error.message:String(error)}))};
    }
  }
  consumeRetryCount() { return this.http.consumeRetryCount(); }
}

export function nowgoalLiveErrorStatus(error: unknown): 'BLOCKED'|'ERROR' {
  return error instanceof ProviderHttpError && (error.status === 403 || error.status === 429) ? 'BLOCKED' : 'ERROR';
}
