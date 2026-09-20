import type { MatchStatistics, NormalizedMatch } from '../../domain/types.js';

/** A boundary reserved for an explicitly permitted data feed; no HTML parsing is implemented. */
export function normalizeStatBunkerRecord(payload: unknown): { match: NormalizedMatch; statistics: MatchStatistics } | null {
  void payload;
  return null;
}
