export function rawProbability(odds: number): number {
  if (!Number.isFinite(odds) || odds <= 1) throw new RangeError('Decimal odds must be finite and greater than 1');
  return 1 / odds;
}

export function overround(rawProbabilities: readonly number[]): number {
  if (rawProbabilities.length < 2 || rawProbabilities.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('A complete market needs at least two positive probabilities');
  }
  return rawProbabilities.reduce((sum, value) => sum + value, 0);
}

export function fairProbability(raw: number, marketOverround: number): number {
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isFinite(marketOverround) || marketOverround <= 0) {
    throw new RangeError('Raw probability and overround must be positive');
  }
  return raw / marketOverround;
}

export function normalizeMarket<T extends string>(odds: Readonly<Record<T, number>>): {
  fairProbabilities: Record<T, number>; overround: number;
} {
  const entries = Object.entries(odds) as Array<[T, number]>;
  const raws = entries.map(([, value]) => rawProbability(value));
  const margin = overround(raws);
  return { fairProbabilities: Object.fromEntries(entries.map(([selection], index) =>
    [selection, fairProbability(raws[index]!, margin)])) as Record<T, number>, overround: margin };
}

export function normalize1X2(homeOdds: number, drawOdds: number, awayOdds: number) {
  const normalized = normalizeMarket({ home: homeOdds, draw: drawOdds, away: awayOdds });
  return { ...normalized.fairProbabilities, overround: normalized.overround };
}

export function normalizeTwoWay(overOdds: number, underOdds: number) {
  const normalized = normalizeMarket({ over: overOdds, under: underOdds });
  return { ...normalized.fairProbabilities, overround: normalized.overround };
}

export function rawOddsMovementPercent(openingOdds: number, currentOdds: number): number {
  return ((currentOdds - openingOdds) / openingOdds) * 100;
}
