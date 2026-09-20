/**
 * The Nowgoal historical qualification found un-timestamped archived rows only.
 * Keep this explicit in the audit rather than pretending they are route data.
 */
export function historicalOddsBackfillAudit() {
  return {
    source: 'nowgoal',
    status: 'NOT_IMPLEMENTED',
    reason: 'Public historical diary rows have no genuine source observation timestamps; importing them as odds_snapshots would fabricate route history.',
    oldestImportedDate: null,
    newestImportedDate: null,
    matchesAttempted: 0,
    matchesMatched: 0,
    matchesUnmatched: 0,
    matchesAmbiguous: 0,
    matchesWith1X2: 0,
    matchesWithAsianHandicap: 0,
    matchesWithGoals: 0,
    matchesWithCorners: 0,
    matchesWithGenuineOpening: 0,
    matchesWithGenuineClosing: 0,
    matchesWithTwoOrMoreGenuineSnapshots: 0,
    matchesWithFullMovementHistory: 0,
    markets: [],
  };
}
