import { createHash } from 'node:crypto';
import { defaultConfig } from '../odds-analysis/config.js';
import { classifyMovement } from '../odds-analysis/engine.js';
import { canonicalSelection } from '../odds-analysis/movement.js';
import { median, medianAbsoluteDeviation } from '../odds-analysis/consensus.js';
import { normalizeMarket } from '../odds-analysis/probability.js';
import { settlePrediction } from './settlement.js';
import type { SettlementOutcome } from './types.js';

export type ArchivedStageOddRow = {
  bookmaker: string;
  market_type: string;
  market_name: string;
  line: number | string | null;
  selection: string;
  odds_decimal: number | string;
  observation_stage: 'PRE_CLOSING' | 'CLOSING';
  source_row_hash?: string;
};

export type StageHistoricalMatchInput = {
  matchId: string;
  competitionId: string;
  kickoffAt: Date;
  sourceKey: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
  odds: ArchivedStageOddRow[];
};

export type StageHistoricalExampleDraft = {
  oddsInputHash: string;
  researchEligible: boolean;
  bookmakerCount: number;
  marketType: string;
  marketName: string;
  line: number | null;
  selection: string;
  openingOdds: number;
  closingOdds: number;
  openingFairProbability: number;
  closingFairProbability: number;
  probabilityDeltaPp: number;
  movementAgreementRatio: number;
  movementClass: ReturnType<typeof classifyMovement>;
  settlementResult: SettlementOutcome;
};

type Stage = 'PRE_CLOSING' | 'CLOSING';
type StageMap = Map<Stage, Map<string, number>>;

function marketSelections(marketType: string, marketName: string, observed: string[]) {
  const descriptor = `${marketType} ${marketName}`.toUpperCase();
  if (/MATCH_RESULT|1X2/.test(descriptor)) return ['HOME','DRAW','AWAY'];
  if (/TOTAL_GOALS|TOTAL_CORNERS|OVER.?UNDER/.test(descriptor)) return ['OVER','UNDER'];
  if (/ASIAN_HANDICAP|HANDICAP/.test(descriptor)) return ['HOME','AWAY'];
  return observed.length >= 2 ? [...new Set(observed)].sort() : [];
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

export function buildStageHistoricalExamples(input: StageHistoricalMatchInput): StageHistoricalExampleDraft[] {
  const groups = new Map<string, ArchivedStageOddRow[]>();
  for (const raw of input.odds) {
    const odds = Number(raw.odds_decimal);
    if (!Number.isFinite(odds) || odds <= 1) continue;
    const line = raw.line == null ? null : Number(raw.line);
    if (line != null && !Number.isFinite(line)) continue;
    const selection = canonicalSelection(String(raw.selection));
    const key = JSON.stringify([String(raw.market_type),String(raw.market_name),line]);
    groups.set(key,[...(groups.get(key) ?? []),{...raw,line,selection,odds_decimal:odds}]);
  }

  const output: StageHistoricalExampleDraft[] = [];
  for (const rows of groups.values()) {
    const first = rows[0]!;
    const marketType = String(first.market_type);
    const marketName = String(first.market_name);
    const line = first.line == null ? null : Number(first.line);
    const expected = marketSelections(marketType,marketName,rows.map((row)=>canonicalSelection(String(row.selection))));
    if (!expected.length) continue;

    const bookmakers = new Map<string, StageMap>();
    for (const row of rows) {
      const bookmaker = String(row.bookmaker).trim().toLowerCase();
      if (!bookmaker) continue;
      const stage = row.observation_stage;
      if (stage !== 'PRE_CLOSING' && stage !== 'CLOSING') continue;
      const byStage = bookmakers.get(bookmaker) ?? new Map<Stage,Map<string,number>>();
      const values = byStage.get(stage) ?? new Map<string,number>();
      values.set(canonicalSelection(String(row.selection)),Number(row.odds_decimal));
      byStage.set(stage,values);
      bookmakers.set(bookmaker,byStage);
    }

    const complete = [...bookmakers.entries()].flatMap(([bookmaker,stages]) => {
      const opening = stages.get('PRE_CLOSING');
      const closing = stages.get('CLOSING');
      if (!opening || !closing || !expected.every((selection)=>opening.has(selection) && closing.has(selection))) return [];
      const openingOdds = Object.fromEntries(expected.map((selection)=>[selection,opening.get(selection)!]));
      const closingOdds = Object.fromEntries(expected.map((selection)=>[selection,closing.get(selection)!]));
      const openingFair = normalizeMarket(openingOdds).fairProbabilities;
      const closingFair = normalizeMarket(closingOdds).fairProbabilities;
      return [{bookmaker,openingOdds,closingOdds,openingFair,closingFair}];
    });
    if (!complete.length) continue;

    const oddsInputHash = stableHash(rows.map((row)=>[
      String(row.bookmaker).toLowerCase(),row.observation_stage,canonicalSelection(String(row.selection)),
      Number(row.odds_decimal),row.line == null ? null : Number(row.line),row.source_row_hash ?? null,
    ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));

    for (const selection of expected) {
      const votes = complete.map((bookmaker)=>({
        openingOdds:Number(bookmaker.openingOdds[selection]),
        closingOdds:Number(bookmaker.closingOdds[selection]),
        openingFair:Number(bookmaker.openingFair[selection]),
        closingFair:Number(bookmaker.closingFair[selection]),
      }));
      const deltas = votes.map((vote)=>(vote.closingFair-vote.openingFair)*100);
      const medianDelta = median(deltas);
      const direction = Math.sign(medianDelta);
      const agreeing = deltas.filter((delta)=>direction===0 ? Math.abs(delta)<0.01 : Math.sign(delta)===direction).length;
      const agreement = agreeing / votes.length;
      const dispersion = medianAbsoluteDeviation(votes.map((vote)=>vote.closingFair*100));
      const settled = settlePrediction({
        marketType,marketName,line,selection,matchStatus:input.status,
        homeScore:input.homeScore,awayScore:input.awayScore,
        homeCorners:input.homeCorners,awayCorners:input.awayCorners,
      });
      if (!settled.outcome) continue;
      output.push({
        oddsInputHash,
        researchEligible: complete.length >= defaultConfig.minimumBookmakerCount,
        bookmakerCount: complete.length,
        marketType,marketName,line,selection,
        openingOdds:round(median(votes.map((vote)=>vote.openingOdds)),4),
        closingOdds:round(median(votes.map((vote)=>vote.closingOdds)),4),
        openingFairProbability:round(median(votes.map((vote)=>vote.openingFair)),8),
        closingFairProbability:round(median(votes.map((vote)=>vote.closingFair)),8),
        probabilityDeltaPp:round(medianDelta,6),
        movementAgreementRatio:round(agreement,6),
        movementClass:classifyMovement(medianDelta,agreement,dispersion),
        settlementResult:settled.outcome,
      });
    }
  }
  return output.sort((a,b)=>`${a.marketType}:${a.marketName}:${a.line}:${a.selection}`
    .localeCompare(`${b.marketType}:${b.marketName}:${b.line}:${b.selection}`));
}
