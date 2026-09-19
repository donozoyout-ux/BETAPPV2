import type { SettlementInput, SettlementOutcome, SettlementResult } from './types.js';

function signOutcome(value: number): SettlementOutcome {
  return value > 1e-9 ? 'WIN' : value < -1e-9 ? 'LOSS' : 'PUSH';
}

export function splitAsianLine(line: number): number[] {
  const quarters = Math.round(line * 4);
  if (quarters % 2 === 0) return [quarters / 4];
  return [(quarters - 1) / 4, (quarters + 1) / 4];
}

function combine(parts: SettlementOutcome[]): SettlementOutcome {
  if (parts.length === 1) return parts[0]!;
  const [a, b] = parts;
  if (a === b) return a!;
  if ((a === 'WIN' && b === 'PUSH') || (a === 'PUSH' && b === 'WIN')) return 'HALF_WIN';
  if ((a === 'LOSS' && b === 'PUSH') || (a === 'PUSH' && b === 'LOSS')) return 'HALF_LOSS';
  return 'PUSH';
}

export function settleTotal(total: number, line: number, selection: string): SettlementOutcome {
  const direction = selection.toUpperCase() === 'OVER' ? 1 : -1;
  return combine(splitAsianLine(line).map((part) => signOutcome((total - part) * direction)));
}

export function settleAsianHandicap(homeGoals: number, awayGoals: number, homeLine: number, selection: string): SettlementOutcome {
  const homeMargin = homeGoals - awayGoals;
  const direction = selection.toUpperCase() === 'HOME' ? 1 : -1;
  return combine(splitAsianLine(homeLine).map((part) => signOutcome((homeMargin + part) * direction)));
}

export function settlePrediction(input: SettlementInput): SettlementResult {
  if (input.matchStatus === 'cancelled') return { outcome: 'VOID', reason: null };
  if (input.matchStatus !== 'finished') return { outcome: null, reason: null };
  if (input.homeScore == null || input.awayScore == null || !input.marketType || !input.selection) {
    return { outcome: null, reason: 'NO_SETTLEMENT_DATA' };
  }
  const type = input.marketType.toUpperCase();
  const selection = input.selection.toUpperCase();
  if (/MATCH_RESULT|1X2/.test(type)) {
    const winner = input.homeScore > input.awayScore ? 'HOME' : input.homeScore < input.awayScore ? 'AWAY' : 'DRAW';
    return { outcome: winner === selection ? 'WIN' : 'LOSS', reason: null };
  }
  if (/TOTAL_GOALS/.test(type) && input.line != null) {
    if (!['OVER', 'UNDER'].includes(selection)) return { outcome: null, reason: 'UNSUPPORTED_MARKET' };
    return { outcome: settleTotal(input.homeScore + input.awayScore, input.line, selection), reason: null };
  }
  if (/ASIAN_HANDICAP/.test(type) && input.line != null) {
    if (!['HOME', 'AWAY'].includes(selection)) return { outcome: null, reason: 'UNSUPPORTED_MARKET' };
    return { outcome: settleAsianHandicap(input.homeScore, input.awayScore, input.line, selection), reason: null };
  }
  if (/TOTAL_CORNERS/.test(type) && input.line != null) {
    if (input.homeCorners == null || input.awayCorners == null) return { outcome: null, reason: 'NO_SETTLEMENT_DATA' };
    if (!['OVER', 'UNDER'].includes(selection)) return { outcome: null, reason: 'UNSUPPORTED_MARKET' };
    return { outcome: settleTotal(input.homeCorners + input.awayCorners, input.line, selection), reason: null };
  }
  return { outcome: null, reason: 'UNSUPPORTED_MARKET' };
}

export function referencePaperReturn(outcome: SettlementOutcome, odds: number): number {
  if (outcome === 'WIN') return odds - 1;
  if (outcome === 'LOSS') return -1;
  if (outcome === 'HALF_WIN') return 0.5 * (odds - 1);
  if (outcome === 'HALF_LOSS') return -0.5;
  return 0;
}
