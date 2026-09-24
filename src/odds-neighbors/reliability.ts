import { oddsNeighborConfig } from './config.js';
import { resultDefinitions } from './result-map.js';
import type { HistoricalNeighborInput, OddsRoute } from './types.js';

export const neighborReliabilityConfig = Object.freeze({ highScore:85, minUsableScore:70, minDisplaySample:3,
  minUsableSample:5, strongSample:10, strongHighRatio:0.8, maxCrossLeagueRatio:0.5,
  weights:{market:30,odds:30,league:20,context:20}, sameCountryPoints:10 });
export type EvidenceStatus = 'INSUFFICIENT_DATA' | 'WEAK_EVIDENCE' | 'MODERATE_EVIDENCE' | 'STRONG_EVIDENCE';
export type NeighborQuality = 'HIGH' | 'MEDIUM' | 'LOW';
type Target = {competitionId:string; country?:string | null; route:OddsRoute};
const round = (n:number) => Math.round(n*100)/100;
const closeness = (a:number,b:number,scale:number) => Number.isFinite(a) && Number.isFinite(b) ? Math.max(0,1-Math.abs(a-b)/scale) : null;
export function scoreNeighbor(target:Target,candidate:Target) {
  const a=target.route,b=candidate.route,c=neighborReliabilityConfig;
  if(a.marketType!==b.marketType || a.marketName!==b.marketName || a.selection!==b.selection || a.line!==b.line) return null;
  const sameLeague=target.competitionId && candidate.competitionId ? target.competitionId===candidate.competitionId : null;
  const countryKnown=Boolean(target.country && candidate.country);
  const oddsParts=[closeness(a.openingOdds,b.openingOdds,oddsNeighborConfig.distanceScales.openingOdds),closeness(a.latestOdds,b.latestOdds,oddsNeighborConfig.distanceScales.latestOdds)];
  // Only existing, vig-adjusted pre-match probabilities; no post-match or invented ratings.
  const contextParts=[closeness(a.openingFairProbability,b.openingFairProbability,oddsNeighborConfig.distanceScales.openingFair),closeness(a.latestFairProbability,b.latestFairProbability,oddsNeighborConfig.distanceScales.latestFair)];
  const points=(parts:Array<number|null>,weight:number) => parts.some(p=>p===null) ? null : round(parts.reduce<number>((s,p)=>s+p!,0)/parts.length*weight);
  const breakdown={market:c.weights.market,odds:points(oddsParts,c.weights.odds),
    league:sameLeague===null ? null : sameLeague ? c.weights.league : countryKnown && target.country===candidate.country ? c.sameCountryPoints : 0,
    context:points(contextParts,c.weights.context)};
  const similarityScore=round(Object.values(breakdown).reduce<number>((sum,n)=>sum+(n??0),0));
  const quality:NeighborQuality=similarityScore>=c.highScore?'HIGH':similarityScore>=c.minUsableScore?'MEDIUM':'LOW';
  return {similarityScore,quality,sameLeague,breakdown,unavailableComponents:Object.entries(breakdown).filter(([,v])=>v===null).map(([k])=>k),
    contextDescription:'Açılış/güncel adil olasılık ve aynı seçim yönü; takım gücü/ranking mevcut değil.'};
}
export function historicalNeighbors(target:Target,candidates:HistoricalNeighborInput[]) {
  const c=neighborReliabilityConfig;
  const seen=new Set<string>();
  const neighbors=candidates.flatMap(candidate=>{
    const scored=scoreNeighbor(target,candidate); if(!scored || seen.has(candidate.matchId)) return []; seen.add(candidate.matchId);
    const definition=resultDefinitions().find(d=>d.market===candidate.route.marketType && d.line===candidate.route.line && d.selection===candidate.route.selection);
    const result=definition?.predicate(candidate)??null;
    return [{matchId:candidate.matchId,date:candidate.kickoffAt,league:candidate.league,homeTeam:candidate.homeTeam,awayTeam:candidate.awayTeam,
      market:candidate.route.marketType,selection:candidate.route.selection,line:candidate.route.line,odds:candidate.route.latestOdds,
      outcome:result===null?'UNAVAILABLE':result?'WIN':'LOSS',...scored}];
  });
  const settled=neighbors.filter(n=>n.outcome!=='UNAVAILABLE');
  const usable=settled.filter(n=>n.quality!=='LOW');
  const wins=settled.filter(n=>n.outcome==='WIN').length,losses=settled.length-wins;
  const usableWins=usable.filter(n=>n.outcome==='WIN').length;
  const averageSimilarityScore=usable.length ? round(usable.reduce((s,n)=>s+n.similarityScore,0)/usable.length):null;
  const highQualityCount=neighbors.filter(n=>n.quality==='HIGH').length;
  const sameLeagueCount=neighbors.filter(n=>n.sameLeague===true).length,crossLeagueCount=neighbors.filter(n=>n.sameLeague===false).length;
  const mixed=usable.length>0 && usable.filter(n=>n.sameLeague!==true).length/usable.length>c.maxCrossLeagueRatio;
  let status:EvidenceStatus='INSUFFICIENT_DATA';
  if(settled.length>=c.minUsableSample && usable.length<c.minUsableSample) status='WEAK_EVIDENCE';
  if(usable.length>=c.minUsableSample) status=mixed?'WEAK_EVIDENCE':'MODERATE_EVIDENCE';
  if(usable.length>=c.strongSample && !mixed && averageSimilarityScore!>=c.highScore && usable.filter(n=>n.quality==='HIGH').length/usable.length>=c.strongHighRatio) status='STRONG_EVIDENCE';
  const weight=usable.reduce((s,n)=>s+n.similarityScore,0);
  return {version:'ODDS_NEIGHBOR_RELIABILITY_V1' as const,averageSimilarityScope:'USABLE_SETTLED' as const,status,sampleSize:neighbors.length,settledSampleSize:settled.length,usableSampleSize:usable.length,wins,losses,usableWins,
    unavailableOutcomeCount:neighbors.length-settled.length,rawWinRate:settled.length?round(wins/settled.length*100):null,
    weightedWinRate:weight?round(usable.filter(n=>n.outcome==='WIN').reduce((s,n)=>s+n.similarityScore,0)/weight*100):null,
    averageSimilarityScore,highQualityCount,mediumQualityCount:neighbors.filter(n=>n.quality==='MEDIUM').length,
    lowQualityCount:neighbors.filter(n=>n.quality==='LOW').length,sameLeagueCount,crossLeagueCount,unknownLeagueCount:neighbors.length-sameLeagueCount-crossLeagueCount,
    sampleCategory:usable.length<c.minDisplaySample?'INSUFFICIENT':usable.length<c.minUsableSample?'LOW_SAMPLE':usable.length<c.strongSample?'MODERATE_SAMPLE':'USABLE_SAMPLE',
    supportingEvidence:status==='STRONG_EVIDENCE'?'NORMAL':status==='MODERATE_EVIDENCE'?'LIMITED':'NONE',
    executionAuthority:false as const,aiPredictionAuthority:false as const,neighbors};
}
export type HistoricalNeighbors = ReturnType<typeof historicalNeighbors>;
