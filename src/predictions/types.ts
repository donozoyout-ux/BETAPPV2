import type { AnalysisItem, MovementClass, OddsSnapshot, QualityGrade } from '../odds-analysis/types.js';

export type PredictionDecision = 'PREDICT' | 'SKIP';
export type PredictionState = 'PREVIEW' | 'LOCKED_PREDICTION' | 'LOCKED_SKIP';
export type HistoricalScope = 'SAME_COMPETITION' | 'GLOBAL_SUPPORTED_COMPETITIONS';
export type SettlementOutcome = 'WIN' | 'LOSS' | 'PUSH' | 'HALF_WIN' | 'HALF_LOSS' | 'VOID';
export type SkipReason = 'NO_ODDS_ANALYSIS' | 'ODDS_NOT_ELIGIBLE' | 'LOW_DATA_QUALITY'
  | 'LOW_MODEL_CONFIDENCE' | 'INSUFFICIENT_BOOKMAKERS' | 'INSUFFICIENT_COMPLETE_STATES'
  | 'MOVEMENT_NOT_SUPPORTED' | 'INSUFFICIENT_HISTORICAL_SAMPLE' | 'LOW_PREDICTION_SCORE'
  | 'CONFLICTING_CORNER_MODEL' | 'LOCK_WINDOW_MISSED' | 'UNSUPPORTED_MARKET' | 'NO_SETTLEMENT_DATA'
  | 'SELF_AUDIT_PAUSED' | 'SELF_AUDIT_SEGMENT_PAUSED';

export type HistoricalExample = {
  id: string; matchId: string; competitionId: string; kickoffAt: Date; oddsInputHash: string;
  featureCutoffAt: Date; featureLeadMinutes: number; analysisEligible: boolean;
  dataQualityGrade: QualityGrade; confidenceGrade: QualityGrade; completeStateBookmakerCount: number;
  minimumCompleteStateCount: number;
  marketType: string; marketName: string; line: number | null; selection: string;
  openingOdds: number; currentOdds: number; openingFairProbability: number; currentFairProbability: number;
  probabilityDeltaPp: number; bookmakerCount: number; movementAgreementRatio: number;
  oddsAnalysisScore: number; dataQualityScore: number; confidenceScore: number; movementClass: MovementClass;
  settlementResult: SettlementOutcome; homeScore: number | null; awayScore: number | null;
  homeCorners: number | null; awayCorners: number | null;
};

export type HistoricalEvidence = {
  exampleIds: string[]; sampleSize: number; settledSampleSize: number; wins: number; losses: number;
  pushes: number; halfWins: number; halfLosses: number; historicalHitRate: number | null;
  wilsonLower95: number | null; wilsonUpper95: number | null; averageSimilarity: number;
  scope: HistoricalScope; historicalFrequencyGapPp: number | null; status: 'SUFFICIENT' | 'INSUFFICIENT_SAMPLE';
};

export type PredictionScoreComponents = {
  marketProbability: number; oddsSignal: number; historicalEvidence: number; historicalSampleReliability: number;
  bookmakerAgreement: number; dataQuality: number; modelConfidence: number;
};

export type PredictionCandidate = {
  marketType: string; marketName: string; line: number | null; selection: string; referenceOdds: number;
  openingOdds: number; currentOdds: number; currentFairProbability: number; probabilityDeltaPp: number;
  predictionScore: number; scoreComponents: PredictionScoreComponents; bookmakerCount: number;
  agreementRatio: number; dataQualityScore: number; dataQualityGrade: QualityGrade;
  confidenceScore: number; confidenceGrade: QualityGrade; movementClass: MovementClass;
  analysisEligible: boolean; snapshotCount: number; completeStateBookmakerCount: number;
  minimumCompleteStateCount: number;
  historical: HistoricalEvidence; cornerModelProbability: number | null; marketFairProbability: number;
  modelMarketGapPp: number | null; cornerQuality: QualityGrade | null; cornerConfirmation: 'CONFIRM' | 'CONFLICT' | 'UNAVAILABLE';
  reasons: string[]; warnings: string[];
};

export type PredictionEvaluation = {
  matchId: string; competitionId: string; kickoffAt: Date; modelVersion: 'PREDICTION_V1'; configHash: string;
  inputHash: string; oddsAnalysisInputHash: string; generatedAt: Date; decision: PredictionDecision;
  selectedCandidate: PredictionCandidate | null; candidates: PredictionCandidate[]; skipReasons: SkipReason[];
  metadata: { executionAuthority: false; aiPredictionAuthority: false; historicalExamplesConsidered: number;
    selfAuditStatus?: 'INSUFFICIENT_DATA' | 'HEALTHY' | 'WATCH' | 'PAUSED'; selfAuditId?: string | null;
    selfAuditGuardActive?: boolean; selfAuditSegmentKeys?: string[];
    selfAuditSegmentStatuses?: Record<string,'INSUFFICIENT_DATA' | 'HEALTHY' | 'WATCH' | 'PAUSED'>;
    selfAuditSegmentGuards?: Record<string,boolean> };
};

export type PredictionTarget = {
  matchId: string; competitionId: string; kickoffAt: Date; oddsInputHash: string; oddsItems: AnalysisItem[];
};

export type PredictionBacktestTarget = {
  matchId: string; competitionId: string; kickoffAt: Date; snapshots: OddsSnapshot[];
};

export type SettlementInput = {
  marketType: string | null; marketName: string | null; line: number | null; selection: string | null;
  matchStatus: string; homeScore: number | null; awayScore: number | null;
  homeCorners?: number | null; awayCorners?: number | null;
};

export type SettlementResult = { outcome: SettlementOutcome | null; reason: SkipReason | null };
