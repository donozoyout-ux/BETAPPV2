import type { MatchOutcomeData, ResultMapRow } from './types.js';

type Predicate = (match: MatchOutcomeData) => boolean | null;
type Definition = { market: string; selection: string; line: number | null; predicate: Predicate };
const scoreTotal = (match: MatchOutcomeData) => match.homeScore == null || match.awayScore == null ? null : match.homeScore + match.awayScore;
const cornersTotal = (match: MatchOutcomeData) => match.homeCorners == null || match.awayCorners == null ? null : match.homeCorners + match.awayCorners;
const cardsTotal = (match: MatchOutcomeData) => {
  const values = [match.homeYellowCards, match.awayYellowCards, match.homeRedCards, match.awayRedCards];
  return values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + Number(value), 0);
};
function overUnder(market: string, line: number, total: (match: MatchOutcomeData) => number | null): Definition[] {
  return ['OVER','UNDER'].map((selection) => ({ market, selection, line, predicate: (match) => { const value = total(match); return value == null ? null : selection === 'OVER' ? value > line : value < line; } }));
}

export function resultDefinitions(): Definition[] {
  const definitions: Definition[] = [
    ...['HOME','DRAW','AWAY'].map((selection) => ({ market: 'MATCH_RESULT', selection, line: null, predicate: (match: MatchOutcomeData) => {
      if (match.homeScore == null || match.awayScore == null) return null; return selection === 'HOME' ? match.homeScore > match.awayScore : selection === 'DRAW' ? match.homeScore === match.awayScore : match.awayScore > match.homeScore;
    } })),
    ...['YES','NO'].map((selection) => ({ market: 'BTTS', selection, line: null, predicate: (match: MatchOutcomeData) => {
      if (match.homeScore == null || match.awayScore == null) return null; const yes = match.homeScore > 0 && match.awayScore > 0; return selection === 'YES' ? yes : !yes;
    } })),
    ...[1.5,2.5,3.5,4.5].flatMap((line) => overUnder('TOTAL_GOALS', line, scoreTotal)),
    // First-half goals are only emitted when genuine half-time scores are stored.
    ...[0.5,1.5].flatMap((line) => overUnder('FIRST_HALF_GOALS', line, (match) => match.firstHalfHomeScore == null || match.firstHalfAwayScore == null ? null : match.firstHalfHomeScore + match.firstHalfAwayScore)),
    ...[6.5,7.5,8.5,9.5,10.5,11.5].flatMap((line) => overUnder('TOTAL_CORNERS', line, cornersTotal)),
    ...[2.5,3.5,4.5,5.5].flatMap((line) => overUnder('TOTAL_CARDS', line, cardsTotal)),
  ];
  return definitions;
}

export function buildResultMap(matches: MatchOutcomeData[]): ResultMapRow[] {
  return resultDefinitions().map((definition) => {
    const values = matches.map(definition.predicate).filter((value): value is boolean => value != null);
    const positiveCount = values.filter(Boolean).length;
    return { market: definition.market, selection: definition.selection, line: definition.line, sampleSize: values.length,
      positiveCount, positiveRate: values.length ? positiveCount / values.length : null, missingCount: matches.length - values.length };
  }).filter((row) => row.sampleSize > 0);
}
