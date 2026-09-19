import { describe, expect, it } from 'vitest';
import type { AnalysisItem } from '../../src/odds-analysis/types.js';
import { predictionConfig } from '../../src/predictions/config.js';
import { PredictionRepository, PredictionService } from '../../src/predictions/service.js';
import type { HistoricalExample, PredictionEvaluation, PredictionTarget } from '../../src/predictions/types.js';

const kickoff = new Date('2026-09-20T18:00:00Z');
const now = new Date('2026-09-20T17:00:00Z');
const looseConfig = { ...predictionConfig, minimumHistoricalSample: 1, targetHistoricalSample: 1,
  minimumPredictionScore: 0, minimumDataQualityScore: 0, minimumConfidenceScore: 0,
  minimumBookmakerCount: 1, minimumCompleteStateCount: 1 };

function item(): AnalysisItem {
  return { marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection: 'OVER',
    openingOdds: 2, currentOdds: 1.8, highestOdds: 2, lowestOdds: 1.8, snapshotCount: 6,
    openingFairProbability: 0.45, currentFairProbability: 0.56, probabilityDeltaPp: 11,
    rawOddsMovementPercent: -10, bookmakerCount: 3, completeStateBookmakerCount: 3,
    minimumCompleteStateCount: 2, agreeingBookmakerCount: 3, disagreeingBookmakerCount: 0,
    movementAgreementRatio: 1, probabilityDispersion: 0.1, oddsDispersion: 0.1,
    movementClass: 'SUPPORT', score: 80,
    scoreComponents: { movement: 30, agreement: 20, coverage: 20, freshness: 15, stability: 15 },
    dataQuality: { score: 90, grade: 'GOOD', analysisEligible: true, warnings: [] },
    modelConfidence: { score: 85, grade: 'GOOD' }, analysisEligible: true, reasons: [], warnings: [],
    modelMarketGapPp: null };
}

function historical(): HistoricalExample {
  return { id: 'h1', matchId: 'old', competitionId: 'league-a', kickoffAt: new Date('2026-09-10T18:00:00Z'),
    oddsInputHash: 'old-input', featureCutoffAt: new Date('2026-09-10T16:30:00Z'), featureLeadMinutes: 90,
    analysisEligible: true, dataQualityGrade: 'GOOD', confidenceGrade: 'GOOD',
    completeStateBookmakerCount: 3, minimumCompleteStateCount: 2,
    marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection: 'OVER',
    openingOdds: 2, currentOdds: 1.8, openingFairProbability: 0.45, currentFairProbability: 0.56,
    probabilityDeltaPp: 11, bookmakerCount: 3, movementAgreementRatio: 1, oddsAnalysisScore: 80,
    dataQualityScore: 90, confidenceScore: 85, movementClass: 'SUPPORT', settlementResult: 'WIN',
    homeScore: 2, awayScore: 1, homeCorners: 5, awayCorners: 4 };
}

describe('PredictionService self audit guard', () => {
  it('turns an otherwise valid official prediction into an immutable SKIP when self audit is PAUSED', async () => {
    const target: PredictionTarget = { matchId: 'target', competitionId: 'league-a', kickoffAt: kickoff,
      oddsInputHash: 'odds-input', oddsItems: [item()] };
    const savedEvaluations: PredictionEvaluation[] = [];
    const lockedEvaluations: PredictionEvaluation[] = [];
    const repository = {
      loadTargets: async () => [target],
      loadHistoricalExamples: async () => [historical()],
      latestSelfAudit: async () => ({
        id: 'audit-1', version: 'SELF_AUDIT_V1', modelVersion: 'PREDICTION_V1', configHash: 'cfg',
        inputHash: 'audit-input', evaluatedAt: now, status: 'PAUSED' as const, settledSampleSize: 40,
        binarySampleSize: 40, recentSampleSize: 40, recentBinarySampleSize: 40, recentPositiveRate: 0.35,
        recentReferencePaperRoi: -0.25, calibrationMae: 0.1, calibrationSampleSize: 30, lossStreak: 3,
        pauseUntil: new Date('2026-09-21T17:00:00Z'), guardActive: true,
        reasons: ['SELF_AUDIT_RECENT_PERFORMANCE_PAUSE'], metrics: {},
      }),
      latestSegmentSelfAudits: async () => [],
      saveRun: async (evaluation: PredictionEvaluation) => { savedEvaluations.push(evaluation); return 'run-1'; },
      lock: async (evaluation: PredictionEvaluation) => { lockedEvaluations.push(evaluation); return true; },
    } as unknown as PredictionRepository;

    const result = await new PredictionService(repository, looseConfig).refreshPreviewsAndLocks(now);
    const saved = savedEvaluations[0]!;
    const locked = lockedEvaluations[0]!;
    expect(saved.decision).toBe('SKIP');
    expect(saved.skipReasons).toContain('SELF_AUDIT_PAUSED');
    expect(saved.metadata.selfAuditStatus).toBe('PAUSED');
    expect(saved.inputHash).not.toBe('odds-input');
    expect(locked.decision).toBe('SKIP');
    expect(result).toMatchObject({ lockedPredictions: 0, lockedSkips: 1, selfAuditBlocked: 1, selfAuditStatus: 'PAUSED' });
  });
  it('blocks only a paused league-market segment while the global audit remains healthy', async () => {
    const target: PredictionTarget = { matchId: 'target-v2', competitionId: 'league-a', kickoffAt: kickoff,
      oddsInputHash: 'odds-input-v2', oddsItems: [item()] };
    const savedEvaluations: PredictionEvaluation[] = [];
    const lockedEvaluations: PredictionEvaluation[] = [];
    const repository = {
      loadTargets: async () => [target],
      loadHistoricalExamples: async () => [historical()],
      latestSelfAudit: async () => ({
        id: 'audit-global', version: 'SELF_AUDIT_V1', modelVersion: 'PREDICTION_V1', configHash: 'cfg',
        inputHash: 'global-input', evaluatedAt: now, status: 'HEALTHY' as const, settledSampleSize: 40,
        binarySampleSize: 40, recentSampleSize: 40, recentBinarySampleSize: 40, recentPositiveRate: 0.6,
        recentReferencePaperRoi: 0.1, calibrationMae: 0.1, calibrationSampleSize: 30, lossStreak: 0,
        pauseUntil: null, guardActive: false, reasons: [], metrics: {},
      }),
      latestSegmentSelfAudits: async () => [{
        id: 'segment-1', version: 'SELF_AUDIT_V2', modelVersion: 'PREDICTION_V1',
        predictionConfigHash: 'cfg', configHash: 'segment-cfg', inputHash: 'segment-input',
        scopeType: 'LEAGUE_MARKET', segmentKey: 'LEAGUE_MARKET:league-a:TOTAL_GOALS',
        competitionId: 'league-a', competitionName: 'League A', marketType: 'TOTAL_GOALS',
        evaluatedAt: now, status: 'PAUSED' as const, settledSampleSize: 14, binarySampleSize: 14,
        recentSampleSize: 14, recentBinarySampleSize: 14, recentPositiveRate: 0.28,
        recentReferencePaperRoi: -0.3, calibrationMae: 0.2, calibrationSampleSize: 12, lossStreak: 5,
        pauseUntil: new Date('2026-09-21T17:00:00Z'), guardActive: true,
        reasons: ['SELF_AUDIT_RECENT_PERFORMANCE_PAUSE'], metrics: {},
      }],
      saveRun: async (evaluation: PredictionEvaluation) => { savedEvaluations.push(evaluation); return 'run-2'; },
      lock: async (evaluation: PredictionEvaluation) => { lockedEvaluations.push(evaluation); return true; },
    } as unknown as PredictionRepository;

    const result = await new PredictionService(repository, looseConfig).refreshPreviewsAndLocks(now);
    const saved = savedEvaluations[0]!;
    expect(saved.decision).toBe('SKIP');
    expect(saved.skipReasons).toContain('SELF_AUDIT_SEGMENT_PAUSED');
    expect(saved.metadata.selfAuditStatus).toBe('HEALTHY');
    expect(saved.metadata.selfAuditSegmentKeys).toContain('LEAGUE_MARKET:league-a:TOTAL_GOALS');
    expect(lockedEvaluations[0]!.decision).toBe('SKIP');
    expect(result).toMatchObject({ selfAuditBlocked: 0, selfAuditSegmentBlocked: 1, activePausedSegments: 1 });
  });

});
