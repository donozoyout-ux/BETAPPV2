import { resultDefinitions } from './result-map.js';
import { findPastTwins } from './engine.js';
import { historicalNeighbors, neighborReliabilityConfig, type EvidenceStatus, type HistoricalNeighbors } from './reliability.js';
import { oddsNeighborConfig } from './config.js';
import type { HistoricalNeighborInput } from './types.js';

type Neighbor = HistoricalNeighbors['neighbors'][number];
export type CoverageNeighbor = Pick<Neighbor,'similarityScore'|'sameLeague'|'unavailableComponents'> & {settled:boolean};
type Policy = Pick<typeof neighborReliabilityConfig,'highScore'|'minUsableScore'|'minDisplaySample'|'minUsableSample'|'strongSample'|'strongHighRatio'|'maxCrossLeagueRatio'>;
const statuses:EvidenceStatus[]=['INSUFFICIENT_DATA','WEAK_EVIDENCE','MODERATE_EVIDENCE','STRONG_EVIDENCE'];
export const percent=(n:number,d:number)=>d?Math.round(n/d*10000)/100:null;
export function percentile(values:number[],p:number):number|null {
  if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),index=(a.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);
  return a[lo]!+(a[hi]!-a[lo]!)*(index-lo);
}
const mean=(a:number[])=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
export function describeScores(a:number[]) {
  const bins=[[0,50,'0–49'],[50,60,'50–59'],[60,70,'60–69'],[70,80,'70–79'],[80,85,'80–84'],[85,90,'85–89'],[90,95,'90–94'],[95,101,'95–100']] as const;
  return {count:a.length,mean:mean(a),quality:{LOW:a.filter(n=>n<neighborReliabilityConfig.minUsableScore).length,MEDIUM:a.filter(n=>n>=neighborReliabilityConfig.minUsableScore&&n<neighborReliabilityConfig.highScore).length,HIGH:a.filter(n=>n>=neighborReliabilityConfig.highScore).length},median:percentile(a,0.5),p25:percentile(a,0.25),p50:percentile(a,0.5),p75:percentile(a,0.75),p90:percentile(a,0.9),p95:percentile(a,0.95),
    bins:Object.fromEntries(bins.map(([lo,hi,key])=>{const count=a.filter(n=>n>=lo&&n<hi).length;return [key,{count,percent:percent(count,a.length)}];}))};
}
export function shadowCoverage(neighbors:CoverageNeighbor[],overrides:Partial<Policy>={}) {
  const c={...neighborReliabilityConfig,...overrides},settled=neighbors.filter(n=>n.settled),usable=settled.filter(n=>n.similarityScore>=c.minUsableScore);
  const averageSimilarity=mean(usable.map(n=>n.similarityScore)),crossRatio=usable.length?usable.filter(n=>n.sameLeague!==true).length/usable.length:0;
  let status:EvidenceStatus='INSUFFICIENT_DATA';
  if(settled.length>=c.minUsableSample&&usable.length<c.minUsableSample)status='WEAK_EVIDENCE';
  if(usable.length>=c.minUsableSample)status=crossRatio>c.maxCrossLeagueRatio?'WEAK_EVIDENCE':'MODERATE_EVIDENCE';
  if(usable.length>=c.strongSample&&crossRatio<=c.maxCrossLeagueRatio&&averageSimilarity!>=c.highScore&&usable.filter(n=>n.similarityScore>=c.highScore).length/usable.length>=c.strongHighRatio)status='STRONG_EVIDENCE';
  return {rawSamples:neighbors.length,settledSamples:settled.length,usableSamples:usable.length,status,averageSimilarity,
    highQuality:neighbors.filter(n=>n.similarityScore>=c.highScore).length,mediumQuality:neighbors.filter(n=>n.similarityScore>=c.minUsableScore&&n.similarityScore<c.highScore).length,
    lowQuality:neighbors.filter(n=>n.similarityScore<c.minUsableScore).length,sameLeague:neighbors.filter(n=>n.sameLeague===true).length,
    crossLeague:neighbors.filter(n=>n.sameLeague===false).length,unknownLeague:neighbors.filter(n=>n.sameLeague===null).length,
    usableSameLeague:usable.filter(n=>n.sameLeague===true).length,usableCrossLeague:usable.filter(n=>n.sameLeague===false).length,
    missingData:neighbors.filter(n=>n.unavailableComponents.length>0).length,crossLeagueDowngraded:usable.length>=c.minUsableSample&&crossRatio>c.maxCrossLeagueRatio};
}
type Summary=ReturnType<typeof shadowCoverage>;
export function summarizeTargets(a:Summary[]) {
  const statusDistribution=Object.fromEntries(statuses.map(s=>{const count=a.filter(n=>n.status===s).length;return[s,{count,percent:percent(count,a.length)}];}));
  const bins=[[0,0,'0'],[1,2,'1–2'],[3,4,'3–4'],[5,9,'5–9'],[10,19,'10–19'],[20,20,'20'],[21,Infinity,'21+']] as const;
  const sampleDistribution=Object.fromEntries(bins.map(([lo,hi,key])=>{const count=a.filter(n=>n.usableSamples>=lo&&n.usableSamples<=hi).length;return[key,{count,percent:percent(count,a.length)}];}));
  const sum=(key:'sameLeague'|'crossLeague'|'unknownLeague'|'rawSamples'|'usableSamples'|'highQuality'|'mediumQuality'|'lowQuality'|'missingData')=>a.reduce((s,n)=>s+n[key],0);
  return {targets:a.length,statusDistribution,sampleDistribution,medianUsable:percentile(a.map(n=>n.usableSamples),0.5),p90Usable:percentile(a.map(n=>n.usableSamples),0.9),
    averageSimilarity:mean(a.flatMap(n=>n.averageSimilarity===null?[]:[n.averageSimilarity])),acceptedSimilarityMedian:percentile(a.filter(n=>['MODERATE_EVIDENCE','STRONG_EVIDENCE'].includes(n.status)).flatMap(n=>n.averageSimilarity===null?[]:[n.averageSimilarity]),0.5),
    fivePlusRate:percent(a.filter(n=>n.usableSamples>=5).length,a.length),tenPlusRate:percent(a.filter(n=>n.usableSamples>=10).length,a.length),zeroUsableRate:percent(a.filter(n=>!n.usableSamples).length,a.length),
    sameLeagueCount:sum('sameLeague'),crossLeagueCount:sum('crossLeague'),unknownLeagueCount:sum('unknownLeague'),sameLeagueRatio:percent(sum('sameLeague'),sum('rawSamples')),
    crossLeagueRatio:percent(sum('crossLeague'),sum('rawSamples')),highQuality:sum('highQuality'),mediumQuality:sum('mediumQuality'),lowQuality:sum('lowQuality'),missingDataExposure:sum('missingData'),
    downgradeCount:a.filter(n=>n.crossLeagueDowngraded).length,downgradeRate:percent(a.filter(n=>n.crossLeagueDowngraded).length,a.length)};
}
export function insufficientReasons(summary:Summary,stages:{earlier:number;market:number;line:number;selection:number},neighbors:Neighbor[],larger?:Summary) {
  const reasons:string[]=[];
  if(!stages.earlier)reasons.push('NO_HISTORICAL_MATCH');
  else if(!stages.market)reasons.push('MARKET_MISMATCH');else if(!stages.line)reasons.push('LINE_MISMATCH');else if(!stages.selection)reasons.push('SELECTION_MISMATCH');
  if(neighbors.some(n=>n.outcome==='UNAVAILABLE'))reasons.push('OUTCOME_UNAVAILABLE');
  if(neighbors.some(n=>n.quality==='LOW'))reasons.push('LOW_SIMILARITY');
  if(neighbors.some(n=>n.quality==='LOW'&&(n.breakdown.odds??0)<neighborReliabilityConfig.weights.odds/2))reasons.push('ODDS_TOO_DIFFERENT');
  if(neighbors.some(n=>n.sameLeague!==true))reasons.push('LEAGUE_CONTEXT_WEAK');
  if(summary.crossLeagueDowngraded)reasons.push('CROSS_LEAGUE_DOMINANCE');
  if(neighbors.some(n=>n.unavailableComponents.length))reasons.push('DATA_MISSING');
  if(larger&&larger.usableSamples>=neighborReliabilityConfig.minUsableSample&&summary.usableSamples<neighborReliabilityConfig.minUsableSample)reasons.push('NEIGHBOR_LIMIT_EFFECT');
  return reasons.length?reasons:['OTHER'];
}
function group<T>(a:T[],key:(v:T)=>string) {const groups=new Map<string,T[]>();for(const item of a){const k=key(item);const bucket=groups.get(k);if(bucket)bucket.push(item);else groups.set(k,[item]);}return groups;}
export function calibrationReport(records:HistoricalNeighborInput[],metadata:Record<string,unknown>,generatedAt:string,targetCap=600) {
  if(!Number.isInteger(targetCap)||targetCap<1||targetCap>5000)throw new Error('targetCap must be 1–5000');
  const sorted=[...records].sort((a,b)=>a.kickoffAt.getTime()-b.kickoffAt.getTime()||a.matchId.localeCompare(b.matchId)||a.route.marketType.localeCompare(b.route.marketType)||a.route.marketName.localeCompare(b.route.marketName)||a.route.selection.localeCompare(b.route.selection)||String(a.route.line).localeCompare(String(b.route.line)));
  // Round robin competition/market strata; evenly spaced chronological picks within each stratum.
  const strata=[...group(sorted,r=>r.competitionId+'|'+r.route.marketType)].sort(([a],[b])=>a.localeCompare(b));
  const quotas=new Map<string,number>();let budget=Math.min(targetCap,sorted.length);
  while(budget>0){for(const [key,rows] of strata){const n=quotas.get(key)??0;if(n<rows.length&&budget>0){quotas.set(key,n+1);budget--;}}}
  const targets=strata.flatMap(([key,rows])=>{const n=quotas.get(key)??0;return Array.from({length:n},(_,i)=>rows[n===1?Math.floor((rows.length-1)/2):Math.floor(i*(rows.length-1)/(n-1))]!);}).sort((a,b)=>a.kickoffAt.getTime()-b.kickoffAt.getTime()||a.matchId.localeCompare(b.matchId));
  const allScores:Array<{score:number;same:boolean|null;market:string;competition:string;country:boolean;breakdown:Neighbor['breakdown']}>=[];
  let parityFailures=0,leakageViolations=0,oneSampleCases=0,twoSampleCases=0,falseConfidenceViolations=0,hundredRawCases=0,hundredWeightedCases=0,noDataViolations=0;
  const analyses=targets.map(target=>{
    const earlier=sorted.filter(c=>c.matchId!==target.matchId&&c.kickoffAt<target.kickoffAt);
    const market=earlier.filter(c=>c.route.marketType===target.route.marketType&&c.route.marketName===target.route.marketName),line=market.filter(c=>c.route.line===target.route.line),selection=line.filter(c=>c.route.selection===target.route.selection);
    const all=findPastTwins(target,selection,{mode:'CLOSEST_NEIGHBORS',limit:selection.length});
    for(const n of all){if(n.kickoffAt>=target.kickoffAt)leakageViolations++;allScores.push({score:n.similarityScore,same:n.sameLeague,market:target.route.marketType,competition:target.league,country:Boolean(n.country),breakdown:n.breakdown});}
    const expanded=historicalNeighbors(target,all.slice(0,100));
    const defaultCount=oddsNeighborConfig.closestLimit,base=historicalNeighbors(target,all.slice(0,defaultCount));
    const coverage=expanded.neighbors.map(n=>({similarityScore:n.similarityScore,sameLeague:n.sameLeague,unavailableComponents:n.unavailableComponents,settled:n.outcome!=='UNAVAILABLE'}));
    const summary=shadowCoverage(coverage.slice(0,defaultCount));if(summary.status!==base.status||summary.usableSamples!==base.usableSampleSize)parityFailures++;
    if(base.settledSampleSize===1)oneSampleCases++;if(base.settledSampleSize===2)twoSampleCases++;
    if(base.settledSampleSize<=2&&base.status==='STRONG_EVIDENCE')falseConfidenceViolations++;
    if(base.rawWinRate===100)hundredRawCases++;if(base.weightedWinRate===100)hundredWeightedCases++;
    if(base.settledSampleSize===0&&base.rawWinRate!==null)noDataViolations++;
    const reasons=insufficientReasons(summary,{earlier:earlier.length,market:market.length,line:line.length,selection:selection.length},base.neighbors,shadowCoverage(coverage));
    return {matchId:target.matchId,kickoffAt:target.kickoffAt.toISOString(),competitionId:target.competitionId,league:target.league,country:target.country??null,market:target.route.marketType,selection:target.route.selection,line:target.route.line,
      ...summary,capReached:base.sampleSize===defaultCount,eligibleCandidates:all.length,screening:{earlierRoutes:earlier.length,marketCompatible:market.length,lineCompatible:line.length,selectionCompatible:selection.length},reasons,coverage,
      sameCountryCrossLeague:all.filter(n=>n.sameLeague===false&&target.country&&n.country===target.country).length};
  });
  const summary=summarizeTargets(analyses),by=(key:(a:typeof analyses[number])=>string)=>Object.fromEntries([...group(analyses,key)].map(([k,a])=>[k,summarizeTargets(a)]));
  const scoreValues=allScores.map(n=>n.score),freq=group(scoreValues,n=>String(n));
  const scoreBy=(key:(a:typeof allScores[number])=>string)=>Object.fromEntries([...group(allScores,key)].map(([k,a])=>[k,describeScores(a.map(n=>n.score))]));
  const sensitivity=(key:keyof Policy,values:number[])=>Object.fromEntries([...new Set([neighborReliabilityConfig[key],...values])].map(value=>[String(value),summarizeTargets(analyses.map(a=>shadowCoverage(a.coverage.slice(0,oddsNeighborConfig.closestLimit),{[key]:value})))]));
  const capSensitivity=Object.fromEntries([20,50,100].map(limit=>[String(limit),{...summarizeTargets(analyses.map(a=>shadowCoverage(a.coverage.slice(0,limit)))),statusChanges:analyses.filter(a=>shadowCoverage(a.coverage.slice(0,limit)).status!==a.status).length}]));
  const components=Object.fromEntries(Object.keys(neighborReliabilityConfig.weights).map(component=>{const key=component as keyof Neighbor['breakdown'],values=allScores.flatMap(n=>n.breakdown[key]===null?[]:[n.breakdown[key]!]);const total=scoreValues.reduce((s,n)=>s+n,0);
    return [key,{averagePoints:mean(values),unavailable:allScores.length-values.length,unavailableRate:percent(allScores.length-values.length,allScores.length),shareOfTotalScore:percent(values.reduce((s,n)=>s+n,0),total),distribution:describeScores(values),
      wouldCrossUsableBoundaryIfFull:allScores.filter(n=>n.score<neighborReliabilityConfig.minUsableScore&&n.score+neighborReliabilityConfig.weights[key]-(n.breakdown[key]??0)>=neighborReliabilityConfig.minUsableScore).length}];}));
  const reasons=(onlyInsufficient:boolean)=>Object.fromEntries([...group(analyses.filter(a=>!onlyInsufficient||a.status==='INSUFFICIENT_DATA').flatMap(a=>a.reasons),x=>x)].map(([k,a])=>[k,a.length]));
  const marketDistribution=by(a=>a.market);
  for(const market of new Set([...resultDefinitions().map(d=>d.market),...sorted.map(r=>r.route.marketType)])) marketDistribution[market]??=summarizeTargets([]);
  const temporal=Object.fromEntries(['oldest','middle','newest'].map((key,i)=>[key,{...summarizeTargets(analyses.slice(Math.floor(analyses.length*i/3),Math.floor(analyses.length*(i+1)/3))),similarity:describeScores(analyses.slice(Math.floor(analyses.length*i/3),Math.floor(analyses.length*(i+1)/3)).flatMap(a=>a.coverage.slice(0,oddsNeighborConfig.closestLimit).map(n=>n.similarityScore))),countryMissing:analyses.slice(Math.floor(analyses.length*i/3),Math.floor(analyses.length*(i+1)/3)).filter(a=>!a.country).length}]));
  const missingCounts=Object.entries(components).map(([name,value])=>({name,count:value.unavailable})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  const weakestMarkets=Object.entries(marketDistribution).map(([market,data])=>({market,targets:data.targets,fivePlusRate:data.fivePlusRate})).sort((a,b)=>a.targets===0?-1:b.targets===0?1:(a.fivePlusRate??0)-(b.fivePlusRate??0)||a.market.localeCompare(b.market));
  const reviewQuestions={
    fivePlusUsableCoverage:summary.fivePlusRate,tenPlusUsableCoverage:summary.tenPlusRate,strongFrequency:summary.statusDistribution.STRONG_EVIDENCE,
    zeroUsableRate:summary.zeroUsableRate,crossLeagueDowngradeCount:summary.downgradeCount,crossLeagueDowngradeRate:summary.downgradeRate,
    sameLeagueCandidateRate:percent(allScores.filter(n=>n.same===true).length,allScores.length),capReachedRate:percent(analyses.filter(a=>a.capReached).length,analyses.length),
    weakestMarkets,mostUnavailableComponent:missingCounts[0]?.count?missingCounts[0]:null,
    scoreSaturation:{at100:percent(scoreValues.filter(n=>n===100).length,scoreValues.length),unique:freq.size,population:scoreValues.length},
    minUsableScoreAssessment:analyses.length?`At runtime gate ${neighborReliabilityConfig.minUsableScore}, median usable=${summary.medianUsable}; zero usable=${summary.zeroUsableRate}%; 5+ coverage=${summary.fivePlusRate}%. This describes availability, not threshold optimality.`:'Unavailable: no eligible target routes.',
    strongSampleReachability:analyses.length?`${analyses.filter(a=>a.usableSamples>=neighborReliabilityConfig.strongSample).length}/${analyses.length} analyses reach ${neighborReliabilityConfig.strongSample} usable samples; ${analyses.filter(a=>a.status==='STRONG_EVIDENCE').length} meet all strong context requirements.`:'Unavailable: no eligible target routes.',
    structuralBugs:parityFailures||leakageViolations||falseConfidenceViolations||noDataViolations?'Audit invariant violation; investigation required.':'No audited invariant violation detected; this is not proof of absence.',structuralFixes:[]};
  return {reviewQuestions,version:'ODDS_NEIGHBOR_CALIBRATION_V2',generatedAt,runtimeConfig:{reliability:neighborReliabilityConfig,neighbors:oddsNeighborConfig},metadata,
    dataset:{eligibleRouteRecords:records.length,targetAnalyses:analyses.length,targetMatches:new Set(analyses.map(a=>a.matchId)).size,candidateRelationships:allScores.length,
      dateFrom:sorted[0]?.kickoffAt.toISOString()??null,dateTo:sorted.at(-1)?.kickoffAt.toISOString()??null,competitions:[...new Set(sorted.map(r=>r.league))].sort(),countries:[...new Set(sorted.flatMap(r=>r.country?[r.country]:[]))].sort(),markets:[...new Set(sorted.map(r=>r.route.marketType))].sort(),
      targetCap,sampling:'Round-robin competition/market strata, evenly spaced chronological positions; every eligible earlier candidate in exported population'},
    similarityDistribution:{overall:describeScores(scoreValues),sameLeague:describeScores(allScores.filter(n=>n.same===true).map(n=>n.score)),crossLeague:describeScores(allScores.filter(n=>n.same===false).map(n=>n.score)),byMarket:scoreBy(n=>n.market),byCompetition:scoreBy(n=>n.competition)},
    summary,marketDistribution,competitionDistribution:by(a=>a.league),sameLeagueAvailability:by(a=>a.sameLeague===0?'NONE':a.crossLeague+a.unknownLeague===0?'ONLY_SAME':'MIXED'),
    leagueDistribution:{onlySame:percent(analyses.filter(a=>a.rawSamples>0&&a.sameLeague===a.rawSamples).length,analyses.length),mixed:percent(analyses.filter(a=>a.sameLeague>0&&a.crossLeague>0).length,analyses.length),primarilyCross:percent(analyses.filter(a=>a.rawSamples>0&&a.crossLeague/a.rawSamples>0.5).length,analyses.length),metadataMissing:percent(analyses.filter(a=>a.unknownLeague>0).length,analyses.length)},
    countryMetadata:{targetsAvailable:analyses.filter(a=>a.country).length,assessment:analyses.length===0?'UNAVAILABLE':analyses.some(a=>a.sameCountryCrossLeague>0)?'Observed same-country cross-league scoring; missing rates limit coverage.':'No same-country cross-league comparisons observed; component contribution is not established.',targetMissingRate:percent(analyses.filter(a=>!a.country).length,analyses.length),candidateRelationshipsAvailable:allScores.filter(n=>n.country).length,candidateMissingRate:percent(allScores.filter(n=>!n.country).length,allScores.length),sameCountryCrossLeague:analyses.reduce((s,a)=>s+a.sameCountryCrossLeague,0)},
    capReached:analyses.filter(a=>a.capReached).length,capReachedRate:percent(analyses.filter(a=>a.capReached).length,analyses.length),capSensitivity,
    similarityThresholdSensitivity:{minUsableScore:sensitivity('minUsableScore',[65,70,75,80]),highScore:sensitivity('highScore',[80,85,90])},
    sampleThresholdSensitivity:{minUsableSample:sensitivity('minUsableSample',[3,5,7,10]),strongSample:sensitivity('strongSample',[8,10,15,20])},components,
    saturation:{uniqueScores:freq.size,topRepeated:[...freq].map(([score,a])=>({score:Number(score),count:a.length,percent:percent(a.length,scoreValues.length)})).sort((a,b)=>b.count-a.count||b.score-a.score).slice(0,10),at100:percent(scoreValues.filter(n=>n===100).length,scoreValues.length),atLeast95:percent(scoreValues.filter(n=>n>=95).length,scoreValues.length),atLeast90:percent(scoreValues.filter(n=>n>=90).length,scoreValues.length),from85to89:percent(scoreValues.filter(n=>n>=85&&n<90).length,scoreValues.length),from70to84:percent(scoreValues.filter(n=>n>=70&&n<85).length,scoreValues.length)},
    temporal,insufficientReasons:reasons(true),allReasonFlags:reasons(false),strongEvidenceCases:analyses.filter(a=>a.status==='STRONG_EVIDENCE').map(a=>{const {coverage,...rest}=a;void coverage;return rest;}),
    safety:{parityFailures,leakageViolations,oneSampleCases,twoSampleCases,falseConfidenceViolations,hundredRawCases,hundredWeightedCases,noDataViolations,productionThresholdsChanged:false,executionAuthority:false,aiPredictionAuthority:false},
    targets:analyses.map(a=>{const {coverage,...rest}=a;void coverage;return rest;}),
    recommendation:'Retain production configuration. Shadow coverage is descriptive, not outcome optimization.',
    verdict:!analyses.length||!allScores.length?'INSUFFICIENT_REAL_DATA':parityFailures||leakageViolations||falseConfidenceViolations||noDataViolations?'STRUCTURAL_FIX_REQUIRED':summary.zeroUsableRate!>50?'V1_CALIBRATION_SPARSE':'V1_CALIBRATION_HEALTHY'};
}
