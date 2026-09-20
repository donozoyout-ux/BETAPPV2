import type { HistoricalDataQuality, HistoricalProviderId } from './types.js';

const priority: Record<string, number> = { fotmob: 1, statbunker: 2, soccerstats: 3, adamchoi: 4 };
const quality: Record<HistoricalDataQuality, number> = { COMPLETE: 4, PARTIAL: 3, LIMITED: 2, POOR: 1 };

export function shouldReplaceHistoricalStats(existingProvider: string | null, existingQuality: HistoricalDataQuality | null,
  incomingProvider: HistoricalProviderId, incomingQuality: HistoricalDataQuality): boolean {
  if (!existingProvider || !existingQuality) return true;
  const existingPriority = priority[existingProvider] ?? Number.MAX_SAFE_INTEGER;
  const incomingPriority = priority[incomingProvider] ?? Number.MAX_SAFE_INTEGER;
  if (incomingPriority < existingPriority) return true;
  if (incomingPriority > existingPriority) return quality[incomingQuality] > quality[existingQuality];
  return quality[incomingQuality] >= quality[existingQuality];
}
