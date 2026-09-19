export type OddsSnapshot = {
  matchId: string;
  provider: string;
  marketType: string;
  marketName: string;
  line: number | null;
  selection: string;
  oddsDecimal: number;
  capturedAt: Date;
};

export type QualityGrade = 'GOOD' | 'LIMITED' | 'POOR';
export type MovementClass = 'STRONG_SUPPORT' | 'SUPPORT' | 'NEUTRAL' | 'OPPOSE' | 'STRONG_OPPOSE';

export type AnalysisConfig = {
  modelVersion: 'ODDS_V1';
  minimumBookmakerCount: number;
  targetBookmakerCount: number;
  minimumSnapshotCount: number;
  minimumProbabilityChangePp: number;
  strongProbabilityChangePp: number;
  maximumDispersionPp: number;
  staleSnapshotMinutes: number;
  minimumAgreementRatio: number;
  confidenceGoodThreshold: number;
  confidenceLimitedThreshold: number;
  qualityGoodThreshold: number;
  qualityLimitedThreshold: number;
  scoreWeights: { movement: number; agreement: number; coverage: number; freshness: number; stability: number };
};

export type BookmakerSelectionMovement = {
  provider: string;
  marketType: string;
  marketName: string;
  line: number | null;
  selection: string;
  openingOdds: number;
  currentOdds: number;
  highestOdds: number;
  lowestOdds: number;
  snapshotCount: number;
  openingFairProbability: number;
  currentFairProbability: number;
  probabilityDeltaPp: number;
  rawOddsMovementPercent: number;
  openingCapturedAt: Date;
  currentCapturedAt: Date;
};

export type ConsensusResult = {
  bookmakerCount: number;
  agreeingBookmakerCount: number;
  disagreeingBookmakerCount: number;
  medianOpeningOdds: number;
  medianCurrentOdds: number;
  highestOdds: number;
  lowestOdds: number;
  snapshotCount: number;
  minimumSelectionSnapshotCount: number;
  medianOpeningFairProbability: number;
  medianCurrentFairProbability: number;
  medianProbabilityDeltaPp: number;
  probabilityDispersion: number;
  oddsDispersion: number;
  movementAgreementRatio: number;
  latestCapturedAt: Date;
};

export type DataQuality = { score: number; grade: QualityGrade; analysisEligible: boolean; warnings: string[] };
export type ModelConfidence = { score: number; grade: QualityGrade };
export type ScoreComponents = { movement: number; agreement: number; coverage: number; freshness: number; stability: number };

export type AnalysisItem = {
  marketType: string;
  marketName: string;
  line: number | null;
  selection: string;
  openingOdds: number;
  currentOdds: number;
  highestOdds: number;
  lowestOdds: number;
  snapshotCount: number;
  openingFairProbability: number;
  currentFairProbability: number;
  probabilityDeltaPp: number;
  rawOddsMovementPercent: number;
  bookmakerCount: number;
  agreeingBookmakerCount: number;
  disagreeingBookmakerCount: number;
  movementAgreementRatio: number;
  probabilityDispersion: number;
  oddsDispersion: number;
  movementClass: MovementClass;
  score: number;
  scoreComponents: ScoreComponents;
  dataQuality: DataQuality;
  modelConfidence: ModelConfidence;
  analysisEligible: boolean;
  reasons: string[];
  warnings: string[];
  modelMarketGapPp: number | null;
};

export type OddsAnalysis = {
  matchId: string;
  kickoffAt: Date;
  generatedAt: Date;
  modelVersion: 'ODDS_V1';
  configHash: string;
  inputHash: string;
  dataQuality: DataQuality;
  modelConfidence: ModelConfidence;
  analysisEligible: boolean;
  items: AnalysisItem[];
  metadata: {
    safeSnapshotCount: number;
    excludedAfterKickoff: number;
    incompleteMarketCount: number;
    latestSnapshotAt: string | null;
    executionAuthority: false;
  };
};

export type CornerMarketComparison = {
  qualityGrade: QualityGrade;
  probabilities: Record<string, { over: number; under: number }>;
};
