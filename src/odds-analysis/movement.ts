import { normalizeMarket, rawOddsMovementPercent } from './probability.js';
import type { BookmakerSelectionMovement, OddsSnapshot } from './types.js';

type CompleteState = { capturedAt: Date; odds: Map<string, number>; fair: Record<string, number> };
export type BookmakerMarket = {
  provider: string; marketType: string; marketName: string; line: number | null;
  complete: boolean; expectedSelections: string[]; completeStateCount: number;
  openingCompleteAt: Date | null; currentCompleteAt: Date | null;
  hasDistinctCompleteStates: boolean; movements: BookmakerSelectionMovement[];
};

export function canonicalSelection(value: string): string {
  const normalized = value.trim().toLocaleUpperCase('tr-TR').replaceAll(/[^A-ZÇĞİÖŞÜ0-9]+/g, '_');
  if (['1', 'HOME', 'EV', 'EV_SAHIBI', 'EV_SAHİBİ'].includes(normalized)) return 'HOME';
  if (['X', 'DRAW', 'BERABERLIK', 'BERABERLİK'].includes(normalized)) return 'DRAW';
  if (['2', 'AWAY', 'DEPLASMAN'].includes(normalized)) return 'AWAY';
  if (['OVER', 'UST', 'ÜST'].includes(normalized)) return 'OVER';
  if (['UNDER', 'ALT'].includes(normalized)) return 'UNDER';
  return normalized;
}

function expectedSelections(marketType: string, marketName: string, observed: string[]): string[] {
  const descriptor = `${marketType} ${marketName}`.toUpperCase();
  if (/1X2|MATCH.?RESULT|FULL.?TIME.?RESULT|MAÇ.?SONUCU/.test(descriptor)) return ['HOME', 'DRAW', 'AWAY'];
  if (/TOTAL|OVER.?UNDER|ALT.?ÜST/.test(descriptor)) return ['OVER', 'UNDER'];
  if (/ASIAN|HANDICAP|HANDİKAP/.test(descriptor)) return ['HOME', 'AWAY'];
  return observed.length >= 2 ? [...observed].sort() : [];
}

function marketKey(snapshot: OddsSnapshot): string {
  return JSON.stringify([snapshot.provider, snapshot.marketType, snapshot.marketName, snapshot.line]);
}

function buildStates(rows: OddsSnapshot[], selections: string[]): CompleteState[] {
  const byTime = new Map<number, OddsSnapshot[]>();
  for (const row of rows) {
    const timestamp = row.capturedAt.getTime();
    byTime.set(timestamp, [...(byTime.get(timestamp) ?? []), row]);
  }
  const current = new Map<string, number>();
  const states: CompleteState[] = [];
  for (const [timestamp, batch] of [...byTime.entries()].sort(([left], [right]) => left - right)) {
    for (const row of batch) current.set(canonicalSelection(row.selection), row.oddsDecimal);
    if (!selections.every((selection) => current.has(selection))) continue;
    const odds = Object.fromEntries(selections.map((selection) => [selection, current.get(selection)!]));
    const normalized = normalizeMarket(odds);
    states.push({ capturedAt: new Date(timestamp), odds: new Map(Object.entries(odds)), fair: normalized.fairProbabilities });
  }
  return states;
}

export function buildBookmakerMarkets(snapshots: OddsSnapshot[]): BookmakerMarket[] {
  const groups = new Map<string, OddsSnapshot[]>();
  for (const snapshot of snapshots) {
    const normalized = { ...snapshot, selection: canonicalSelection(snapshot.selection) };
    const key = marketKey(normalized);
    groups.set(key, [...(groups.get(key) ?? []), normalized]);
  }
  return [...groups.values()].map((rows) => {
    const first = rows[0]!;
    const observed = [...new Set(rows.map((row) => row.selection))];
    const selections = expectedSelections(first.marketType, first.marketName, observed);
    const states = selections.length >= 2 ? buildStates(rows, selections) : [];
    const opening = states[0];
    const current = states.at(-1);
    const minimumMarketSelectionSnapshotCount = selections.length
      ? Math.min(...selections.map((selection) => rows.filter((row) => row.selection === selection).length)) : 0;
    const movements = !opening || !current ? [] : selections.map((selection) => {
      const selectionRows = rows.filter((row) => row.selection === selection);
      const openingOdds = opening.odds.get(selection)!;
      const currentOdds = current.odds.get(selection)!;
      return {
        provider: first.provider, marketType: first.marketType, marketName: first.marketName, line: first.line, selection,
        openingOdds, currentOdds, highestOdds: Math.max(...selectionRows.map((row) => row.oddsDecimal)),
        lowestOdds: Math.min(...selectionRows.map((row) => row.oddsDecimal)), snapshotCount: selectionRows.length,
        minimumMarketSelectionSnapshotCount,
        completeStateCount: states.length, openingCompleteAt: opening.capturedAt, currentCompleteAt: current.capturedAt,
        hasDistinctCompleteStates: states.length >= 2 && opening.capturedAt.getTime() < current.capturedAt.getTime()
          && minimumMarketSelectionSnapshotCount >= 2,
        openingFairProbability: opening.fair[selection]!, currentFairProbability: current.fair[selection]!,
        probabilityDeltaPp: (current.fair[selection]! - opening.fair[selection]!) * 100,
        rawOddsMovementPercent: rawOddsMovementPercent(openingOdds, currentOdds),
        openingCapturedAt: opening.capturedAt, currentCapturedAt: current.capturedAt,
      };
    });
    return { provider: first.provider, marketType: first.marketType, marketName: first.marketName,
      line: first.line, complete: movements.length > 0, expectedSelections: selections, completeStateCount: states.length,
      openingCompleteAt: opening?.capturedAt ?? null, currentCompleteAt: current?.capturedAt ?? null,
      hasDistinctCompleteStates: Boolean(opening && current && states.length >= 2
        && opening.capturedAt.getTime() < current.capturedAt.getTime()
        && minimumMarketSelectionSnapshotCount >= 2), movements };
  });
}
