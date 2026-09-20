export type ArchivedOddsStateGroup = 'CURRENT_FIELD_GROUP';

export type HistoricalArchivedOddsState = {
  provider: string;
  providerMatchId: string;
  marketType: string;
  marketName: string;
  line: number | null;
  selection: string;
  oddsDecimal: number;
  stateGroup: ArchivedOddsStateGroup;
  sourceDate: string;
  sourceObservationAt: null;
  matchKickoffAt: Date;
  fetchedAt: Date;
  rawPayloadHash: string;
  provenance: Record<string, unknown>;
};

export type HistoricalArchivedFixture = {
  providerMatchId: string;
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
  leagueName: string | null;
  finished: boolean;
};

export type HistoricalArchivedMatchResolution =
  | { status: 'MATCHED'; matchId: string; confidence: 'PROVIDER_ID' | 'EXACT' | 'HIGH' | 'MEDIUM' }
  | { status: 'UNMATCHED' }
  | { status: 'AMBIGUOUS'; candidates: string[] };

export type ArchivedOddsBackfillProgress = {
  datesRequested: number;
  fixturesSeen: number;
  finishedFixtures: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  statesSeen: number;
  inserted: number;
  duplicates: number;
  errors: number;
  cursorDate: string | null;
};

export type ArchivedOddsNeighbor = {
  matchId: string;
  kickoffAt: Date;
  league: string;
  homeTeam: string;
  awayTeam: string;
  archivedOdds: number;
  targetOdds: number;
  relativeDifference: number;
  similarity: number;
  bookmakerCount: number;
  homeScore: number | null;
  awayScore: number | null;
  outcome: 'WIN' | 'LOSS' | 'PUSH' | 'UNAVAILABLE';
};

export type ArchivedOddsMatchAnalysis = {
  matchId: string;
  marketType: string;
  marketName: string;
  line: number | null;
  selection: string;
  targetOdds: number;
  sourceLabel: 'NOWGOAL_ARCHIVED_CURRENT_FIELD_GROUP';
  semantics: 'ARCHIVED_ODDS_LEVEL_ONLY';
  routeEligible: false;
  openingClosingKnown: false;
  sampleSize: number;
  positiveCount: number;
  positiveRate: number | null;
  averageSimilarity: number | null;
  neighbors: ArchivedOddsNeighbor[];
};
