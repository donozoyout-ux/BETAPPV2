export type HistoricalCornerMatch = {
  matchId: string;
  competitionId: string;
  season: string;
  kickoffAt: Date;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number | null;
  awayGoals: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
  firstHalfHomeCorners: number | null;
  firstHalfAwayCorners: number | null;
  homeXg: number | null;
  awayXg: number | null;
  homeShots: number | null;
  awayShots: number | null;
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  homePossession: number | null;
  awayPossession: number | null;
  homeFouls: number | null;
  awayFouls: number | null;
  homeYellowCards: number | null;
  awayYellowCards: number | null;
  homeRedCards: number | null;
  awayRedCards: number | null;
  provider: string;
  sourceTimestamp: Date;
  competitionName?: string;
  homeTeamName?: string;
  awayTeamName?: string;
};

export type ProfileWindow = 'LAST_5' | 'LAST_10' | 'LAST_20' | 'SEASON';
export type Venue = 'HOME' | 'AWAY';

export type TeamCornerProfile = {
  teamId: string;
  competitionId: string;
  season: string;
  windowType: ProfileWindow;
  venue: Venue;
  sampleSize: number;
  cornersForAvg: number | null;
  cornersAgainstAvg: number | null;
  totalMatchCornersAvg: number | null;
  cornersForStddev: number | null;
  cornersAgainstStddev: number | null;
  overRates: Record<string, number>;
  firstHalfCornersForAvg: number | null;
  firstHalfCornersAgainstAvg: number | null;
};

export type LeagueCornerBaseline = {
  competitionId: string;
  season: string;
  avgHomeCorners: number;
  avgAwayCorners: number;
  avgTotalCorners: number;
  stddevTotalCorners: number;
  varianceTotalCorners: number;
  overRates: Record<string, number>;
  sampleSize: number;
};

export type DistributionMode = 'POISSON' | 'NEGATIVE_BINOMIAL' | 'AUTO';
export type DataQualityStatus = 'EXCELLENT' | 'GOOD' | 'LIMITED' | 'POOR';

export type CornerAnalysis = {
  expectedHomeCorners: number;
  expectedAwayCorners: number;
  expectedTotalCorners: number;
  probabilities: Record<string, { over: number; under: number }>;
  distribution: Exclude<DistributionMode, 'AUTO'>;
  dataQuality: { score: number; status: DataQualityStatus; analysisEligible: boolean; missingFields: string[] };
  modelConfidence: number;
  sample: { home: number; away: number; league: number; h2h: number };
  calculationDetails: Record<string, unknown>;
};
