import { canonicalSelection } from '../odds-analysis/movement.js';
import { normalizeMarket } from '../odds-analysis/probability.js';
import type { OddsSnapshot } from '../odds-analysis/types.js';
import { oddsNeighborConfig, type OddsNeighborConfig } from './config.js';
import type { OddsRoute, RouteDirection, RouteSnapshot } from './types.js';

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
function round(value: number, digits = 6): number { return Number(value.toFixed(digits)); }
function identity(snapshot: OddsSnapshot) { return JSON.stringify([snapshot.marketType, snapshot.marketName, snapshot.line]); }
function expected(rows: OddsSnapshot[]): string[] {
  const descriptor = `${rows[0]?.marketType ?? ''} ${rows[0]?.marketName ?? ''}`.toUpperCase();
  if (/1X2|MATCH.?RESULT|FULL.?TIME.?RESULT/.test(descriptor)) return ['HOME','DRAW','AWAY'];
  if (/TOTAL|OVER.?UNDER|ALT.?ÜST|CORNER|CARD/.test(descriptor)) return ['OVER','UNDER'];
  return [...new Set(rows.map((row) => canonicalSelection(row.selection)))].sort();
}

/** Builds route points from real, pre-kickoff snapshots only; no interpolation is performed. */
export function buildOddsRoute(matchId: string, kickoffAt: Date, allSnapshots: OddsSnapshot[], marketType: string,
  marketName: string, line: number | null, selection: string, generatedAt = new Date(), config: OddsNeighborConfig = oddsNeighborConfig): OddsRoute | null {
  const selected = canonicalSelection(selection);
  const marketRows = allSnapshots.filter((row) => row.matchId === matchId && identity(row) === JSON.stringify([marketType, marketName, line])
    && row.capturedAt < kickoffAt && row.capturedAt <= generatedAt && row.oddsDecimal > 1);
  const selections = expected(marketRows);
  if (!marketRows.length || !selections.includes(selected)) return null;
  const providerStates = new Map<string, Array<{ capturedAt: Date; odds: number; fair: number }>>();
  for (const [provider, rows] of new Map([...marketRows].map((row) => [row.provider, marketRows.filter((item) => item.provider === row.provider)])).entries()) {
    const current = new Map<string, number>(); const states: Array<{ capturedAt: Date; odds: number; fair: number }> = [];
    const byTime = new Map<number, OddsSnapshot[]>();
    for (const row of rows) byTime.set(row.capturedAt.getTime(), [...(byTime.get(row.capturedAt.getTime()) ?? []), row]);
    for (const [time, batch] of [...byTime.entries()].sort(([a], [b]) => a - b)) {
      for (const row of batch) current.set(canonicalSelection(row.selection), row.oddsDecimal);
      if (!selections.every((item) => current.has(item))) continue;
      const fair = normalizeMarket(Object.fromEntries(selections.map((item) => [item, current.get(item)!]))).fairProbabilities[selected];
      if (fair != null) states.push({ capturedAt: new Date(time), odds: current.get(selected)!, fair });
    }
    if (states.length) providerStates.set(provider, states);
  }
  const grouped = new Map<number, Array<{ odds: number; fair: number }>>();
  for (const states of providerStates.values()) for (const state of states) grouped.set(state.capturedAt.getTime(), [...(grouped.get(state.capturedAt.getTime()) ?? []), state]);
  const snapshots: RouteSnapshot[] = [...grouped.entries()].sort(([a], [b]) => a - b).map(([time, values]) => ({
    capturedAt: new Date(time), medianOdds: round(median(values.map((item) => item.odds))), fairProbability: round(median(values.map((item) => item.fair))), bookmakerCount: values.length,
  }));
  if (!snapshots.length) return null;
  const first = snapshots[0]!; const last = snapshots.at(-1)!;
  const deltas = snapshots.slice(1).map((item, index) => (item.fairProbability - snapshots[index]!.fairProbability) * 100);
  const signs = deltas.map((value) => Math.abs(value) < 0.01 ? 0 : Math.sign(value)).filter((value) => value !== 0);
  const directionChanges = signs.slice(1).filter((value, index) => value !== signs[index]!).length;
  const totalMovementPp = (last.fairProbability - first.fairProbability) * 100;
  const path = deltas.reduce((sum, value) => sum + Math.abs(value), 0);
  const fairPp = snapshots.map((item) => item.fairProbability * 100);
  let maximumPullbackPp = 0;
  if (totalMovementPp >= 0) { let peak = fairPp[0]!; for (const value of fairPp) { peak = Math.max(peak, value); maximumPullbackPp = Math.max(maximumPullbackPp, peak - value); } }
  else { let trough = fairPp[0]!; for (const value of fairPp) { trough = Math.min(trough, value); maximumPullbackPp = Math.max(maximumPullbackPp, value - trough); } }
  const latestByBookmaker = [...providerStates.values()].map((states) => states.at(-1)!).filter(Boolean);
  const latestFairs = latestByBookmaker.map((item) => item.fair);
  const finalSign = Math.sign(totalMovementPp);
  const changed = [...providerStates.values()].map((states) => (states.at(-1)!.fair - states[0]!.fair) * 100);
  const agreement = changed.length ? changed.filter((value) => finalSign === 0 ? Math.abs(value) < 0.01 : Math.sign(value) === finalSign).length / changed.length : 0;
  const durationMinutes = (last.capturedAt.getTime() - first.capturedAt.getTime()) / 60_000;
  const direction: RouteDirection = Math.abs(totalMovementPp) < 0.25 ? 'FLAT' : directionChanges > 1 || Math.abs(totalMovementPp) / Math.max(path, 0.01) < 0.5 ? 'MIXED' : totalMovementPp > 0 ? 'UP' : 'DOWN';
  const magnitude = Math.abs(totalMovementPp); const strength = magnitude >= config.routeStrongPp ? 'STRONG' : magnitude >= config.routeModeratePp ? 'MODERATE' : 'WEAK';
  return { matchId, marketType, marketName, line, selection: selected, bookmakers: [...providerStates.keys()].sort(), openingOdds: first.medianOdds, latestOdds: last.medianOdds,
    snapshots, openingFairProbability: first.fairProbability, latestFairProbability: last.fairProbability, totalMovementPp: round(totalMovementPp), genuineObservations: snapshots.length,
    durationMinutes: round(durationMinutes), velocityPpPerHour: round(durationMinutes > 0 ? totalMovementPp / (durationMinutes / 60) : 0), directionChanges,
    maximumPullbackPp: round(maximumPullbackPp), monotonicityRatio: round(path ? Math.abs(totalMovementPp) / path : 1), bookmakerAgreement: round(agreement),
    bookmakerDispersionPp: round(latestFairs.length ? median(latestFairs.map((value) => Math.abs(value - median(latestFairs)))) * 100 : 0), lineStability: 1,
    freshnessMinutes: round(Math.max(0, (generatedAt.getTime() - last.capturedAt.getTime()) / 60_000)), direction, strength };
}
