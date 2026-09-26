import type { OddsSnapshot } from '../odds-analysis/types.js';

export type RouteDirection = 'UP' | 'DOWN' | 'FLAT' | 'MIXED';
export type RouteStrength = 'WEAK' | 'MODERATE' | 'STRONG';
export type SearchMode = 'CLOSEST_NEIGHBORS' | 'ODDS_BAND';
export type SignalState = 'SUPPORT' | 'NEUTRAL' | 'CONFLICT' | 'UNAVAILABLE';
export type EvidenceStrength = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH';

export type RouteSnapshot = { capturedAt: Date; medianOdds: number; fairProbability: number; bookmakerCount: number };
export type OddsRoute = {
  matchId: string; marketType: string; marketName: string; line: number | null; selection: string;
  bookmakers: string[]; openingOdds: number; latestOdds: number; snapshots: RouteSnapshot[];
  openingFairProbability: number; latestFairProbability: number; totalMovementPp: number;
  genuineObservations: number; durationMinutes: number; velocityPpPerHour: number; directionChanges: number;
  maximumPullbackPp: number; monotonicityRatio: number; bookmakerAgreement: number; bookmakerDispersionPp: number;
  lineStability: number; freshnessMinutes: number; direction: RouteDirection; strength: RouteStrength;
};

export type MatchOutcomeData = {
  matchId: string; competitionId: string; country?: string | null; kickoffAt: Date; league: string; homeTeam: string; awayTeam: string;
  homeScore: number | null; awayScore: number | null; firstHalfHomeScore: number | null; firstHalfAwayScore: number | null;
  homeCorners: number | null; awayCorners: number | null; homeYellowCards: number | null; awayYellowCards: number | null;
  homeRedCards: number | null; awayRedCards: number | null;
};

export type HistoricalNeighborInput = MatchOutcomeData & { route: OddsRoute };
export type HistoricalTwin = HistoricalNeighborInput & NonNullable<ReturnType<typeof import('./reliability.js').scoreNeighbor>> & {
  exampleId: string; distance: number; similarity: number; matchedDimensions: string[]; differences: Record<string, number>;
  openingOdds: number; decisionOdds: number; outcome: { home: number | null; away: number | null };
};

export type SearchOptions = { mode: SearchMode; limit: number; bandPercent?: number; minimumOdds?: number; maximumOdds?: number };
export type ResultMapRow = { market: string; selection: string; line: number | null; sampleSize: number; positiveCount: number; positiveRate: number | null; missingCount: number };
export type WilsonInterval = { lower: number | null; upper: number | null };
export type EvidenceGap = ResultMapRow & { baselineRate: number | null; baselineSampleSize: number; baselineScope: 'SAME_COMPETITION' | 'GLOBAL_SUPPORTED_COMPETITIONS' | 'UNAVAILABLE'; gapPp: number | null; wilson: WilsonInterval };
export type ConflictCheck = { source: 'ODDS_TWINS' | 'ODDS_ROUTE' | 'TEAM_HISTORICAL_STATS' | 'XG' | 'CORNERS_MODEL'; state: SignalState; reason: string };
export type OddsIntelligence = {
  match: { id: string; kickoffAt: Date; league: string; homeTeam: string; awayTeam: string }; primaryMarket: Pick<OddsRoute, 'marketType' | 'marketName' | 'line' | 'selection'>;
  historicalNeighbors: import('./reliability.js').HistoricalNeighbors;
  oddsRoute: OddsRoute; searchMode: SearchMode; pastTwins: HistoricalTwin[]; resultMap: ResultMapRow[]; evidenceGap: EvidenceGap[];
  evidenceStrength: EvidenceStrength; conflictCheck: ConflictCheck[]; dataCompleteness: { routeSnapshots: number; neighbors: number; resultRowsWithData: number; resultRows: number };
  generatedAt: Date; executionAuthority: false; aiPredictionAuthority: false;
};

export type SnapshotSource = OddsSnapshot;
