import type { NormalizedOdds } from '../domain/odds.js';

export type PublicIddaaMarket = {
  name: string;
  selections?: Array<{ name: string; odds: number | string }>;
};

function parseLine(value: string): number | null {
  const match = value.replace(',', '.').match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? Number(match[1]) : null;
}

function marketType(name: string): string {
  const value = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/mac sonucu|\b1x2\b/.test(value)) return 'MATCH_RESULT';
  if (/cifte sans/.test(value)) return 'DOUBLE_CHANCE';
  if (/karsilikli gol|kg var|btts/.test(value)) return 'BTTS';
  if (/korner/.test(value)) return 'TOTAL_CORNERS';
  if (/kart/.test(value)) return 'TOTAL_CARDS';
  if (/ilk yari/.test(value)) return 'FIRST_HALF';
  if (/toplam gol|alt.?ust|over.?under/.test(value)) return 'TOTAL_GOALS';
  return 'OTHER';
}

export function normalizeIddaaMarkets(
  providerMatchId: string,
  markets: PublicIddaaMarket[],
  capturedAt = new Date(),
): NormalizedOdds[] {
  return markets.flatMap((market) => (market.selections ?? []).flatMap((selection) => {
    const oddsDecimal = typeof selection.odds === 'number' ? selection.odds : Number(selection.odds.replace(',', '.'));
    if (!Number.isFinite(oddsDecimal) || oddsDecimal <= 1) return [];
    return [{ provider: 'iddaa', providerMatchId, marketType: marketType(market.name), marketName: market.name,
      line: parseLine(`${market.name} ${selection.name}`), selection: selection.name, oddsDecimal, capturedAt }];
  }));
}
