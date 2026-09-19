import type { PredictionConfig } from './config.js';
import { predictionConfig } from './config.js';
import { analyzeOdds } from '../odds-analysis/engine.js';
import { evaluatePrediction } from './engine.js';
import { referencePaperReturn } from './settlement.js';
import type { HistoricalExample, PredictionBacktestTarget, PredictionTarget, SettlementOutcome } from './types.js';

export type PerformanceRecord = {
  decision: 'PREDICT' | 'SKIP'; outcome: SettlementOutcome | null; marketType: string | null;
  league: string; predictionScore: number | null; confidenceScore: number | null; dataQualityGrade: string | null;
  bookmakerCount: number | null; historicalSampleSize: number; historicalHitRate: number | null;
  movementClass: string | null; referencePaperReturn: number | null;
};

const positive = (outcome: SettlementOutcome | null) => outcome === 'WIN' || outcome === 'HALF_WIN';
const bucket = (value: number | null, cuts: number[]) => {
  if (value == null) return 'N/A';
  const lower = [...cuts].reverse().find((cut) => value >= cut);
  if (lower == null) return `<${cuts[0]}`;
  const next = cuts.find((cut) => cut > lower);
  return next == null ? `${lower}+` : `${lower}-${next - 1}`;
};

function breakdown(records: PerformanceRecord[], key: (record: PerformanceRecord) => string) {
  const groups = new Map<string, PerformanceRecord[]>();
  for (const record of records) groups.set(key(record), [...(groups.get(key(record)) ?? []), record]);
  return Object.fromEntries([...groups].map(([name, rows]) => {
    const settled = rows.filter((row) => row.outcome != null && row.outcome !== 'VOID' && row.outcome !== 'PUSH');
    const positives = settled.filter((row) => positive(row.outcome)).length;
    return [name, { sampleSize: rows.length, settledSampleSize: settled.length, positiveSettlements: positives,
      positiveRate: settled.length ? positives / settled.length : null }];
  }));
}

export function buildPerformance(records: PerformanceRecord[], smallSampleThreshold = 30) {
  const official = records;
  const predictions = official.filter((row) => row.decision === 'PREDICT');
  const outcomes = (name: SettlementOutcome) => predictions.filter((row) => row.outcome === name).length;
  const settled = predictions.filter((row) => row.outcome != null).length;
  const scoreCalibration = breakdown(predictions.filter((row) => row.outcome != null),
    (row) => bucket(row.predictionScore, [70, 75, 80, 85, 90]));
  const historicalCalibration = breakdown(predictions.filter((row) => row.outcome != null),
    (row) => bucket(row.historicalHitRate == null ? null : row.historicalHitRate * 100, [50, 60, 70, 80, 90]));
  return {
    totalOfficialDecisions: official.length, predictCount: predictions.length,
    skipCount: official.filter((row) => row.decision === 'SKIP').length,
    pending: predictions.length - settled, settled, win: outcomes('WIN'), halfWin: outcomes('HALF_WIN'),
    push: outcomes('PUSH'), halfLoss: outcomes('HALF_LOSS'), loss: outcomes('LOSS'), void: outcomes('VOID'),
    referencePaperUnits: predictions.reduce((sum, row) => sum + (row.referencePaperReturn ?? 0), 0),
    referencePaperRoi: settled ? predictions.reduce((sum, row) => sum + (row.referencePaperReturn ?? 0), 0) / settled : null,
    referencePaperReturnNotice: 'Uses stored reference odds; not verified executable betting returns.',
    byMarket: breakdown(official, (row) => row.marketType ?? 'SKIP'), byLeague: breakdown(official, (row) => row.league),
    byPredictionScore: scoreCalibration,
    byModelConfidence: breakdown(official, (row) => bucket(row.confidenceScore, [45, 60, 75, 90])),
    byDataQuality: breakdown(official, (row) => row.dataQualityGrade ?? 'N/A'),
    byBookmakerCount: breakdown(official, (row) => bucket(row.bookmakerCount, [3, 5, 7])),
    byHistoricalSampleSize: breakdown(official, (row) => bucket(row.historicalSampleSize, [30, 50, 100, 200])),
    byHistoricalHitRate: historicalCalibration,
    byMovementClass: breakdown(official, (row) => row.movementClass ?? 'N/A'),
    scoreCalibration, historicalCalibration, smallSampleThreshold,
    calibrationWarning: settled < smallSampleThreshold ? `Small sample: N=${settled}; calibration is not established.` : null,
  };
}

export function runPredictionBacktest(targets: PredictionTarget[], examples: HistoricalExample[],
  config: PredictionConfig = predictionConfig) {
  const sorted = [...targets].sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
  const eligibleExamples = examples.filter((example) => example.analysisEligible);
  let futureLeakageViolations = 0;
  const records: PerformanceRecord[] = [];
  const evaluations = sorted.map((target) => {
    const available = eligibleExamples.filter((example) => example.kickoffAt < target.kickoffAt);
    const evaluation = evaluatePrediction(target, available, target.kickoffAt, config);
    const used = new Set(evaluation.candidates.flatMap((candidate) => candidate.historical.exampleIds));
    futureLeakageViolations += eligibleExamples.filter((example) => used.has(example.id) && example.kickoffAt >= target.kickoffAt).length;
    const selected = evaluation.selectedCandidate;
    const settled = selected == null ? null : eligibleExamples.find((example) => example.matchId === target.matchId
      && example.marketType === selected.marketType && example.marketName === selected.marketName
      && example.line === selected.line && example.selection === selected.selection)?.settlementResult ?? null;
    records.push({ decision: evaluation.decision, outcome: settled, marketType: selected?.marketType ?? null,
      league: target.competitionId, predictionScore: selected?.predictionScore ?? null,
      confidenceScore: selected?.confidenceScore ?? null, dataQualityGrade: selected?.dataQualityGrade ?? null,
      bookmakerCount: selected?.bookmakerCount ?? null, historicalSampleSize: selected?.historical.sampleSize ?? 0,
      historicalHitRate: selected?.historical.historicalHitRate ?? null, movementClass: selected?.movementClass ?? null,
      referencePaperReturn: settled && selected ? referencePaperReturn(settled, selected.referenceOdds) : null });
    return evaluation;
  });
  const performance = buildPerformance(records);
  return {
    status: performance.predictCount > 0 && performance.settled > 0 ? 'PASS' : 'PARTIAL',
    matchesEvaluated: evaluations.length, targetsEvaluated: evaluations.length,
    targetsWithOddsAtLock: evaluations.filter((item) => item.candidates.some((candidate) => candidate.analysisEligible)).length,
    targetsWithoutOddsAtLock: evaluations.filter((item) => !item.candidates.some((candidate) => candidate.analysisEligible)).length,
    officialSimulatedPredictions: evaluations.filter((item) => item.decision === 'PREDICT').length,
    simulatedSkips: evaluations.filter((item) => item.decision === 'SKIP').length,
    settledPredictions: performance.settled, win: performance.win, halfWin: performance.halfWin, push: performance.push,
    halfLoss: performance.halfLoss, loss: performance.loss, futureLeakageViolations,
    historicalExamplesEligible: eligibleExamples.length, historicalExamplesRejectedIneligible: examples.length - eligibleExamples.length,
    postKickoffSnapshotsExcluded: 0, afterSimulatedLockSnapshotsExcluded: 0,
    postKickoffLeakageViolations: 0, decisionTimeLeakageViolations: 0, performance, evaluations,
  };
}

export function runPredictionBacktestFromSnapshots(targets: PredictionBacktestTarget[], examples: HistoricalExample[],
  config: PredictionConfig = predictionConfig) {
  let postKickoffSnapshotsExcluded = 0;
  let afterSimulatedLockSnapshotsExcluded = 0;
  let postKickoffLeakageViolations = 0;
  let decisionTimeLeakageViolations = 0;
  const reconstructed = [...targets].sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime()).map((target) => {
    const simulatedLockAt = new Date(target.kickoffAt.getTime() - config.officialWindowStartMinutes * 60_000);
    const preKickoff = target.snapshots.filter((snapshot) => snapshot.capturedAt < target.kickoffAt);
    const safeAtLock = preKickoff.filter((snapshot) => snapshot.capturedAt <= simulatedLockAt
      && Number.isFinite(snapshot.oddsDecimal) && snapshot.oddsDecimal > 1);
    postKickoffSnapshotsExcluded += target.snapshots.length - preKickoff.length;
    afterSimulatedLockSnapshotsExcluded += preKickoff.length - safeAtLock.length;
    const analysis = analyzeOdds(target.matchId, target.kickoffAt, target.snapshots, { generatedAt: simulatedLockAt });
    // Both counters are evidence-based audits of the reconstructed target input.
    postKickoffLeakageViolations += analysis.metadata.unsafeSnapshotsUsed;
    if (analysis.metadata.safeSnapshotCount !== safeAtLock.length) decisionTimeLeakageViolations += 1;
    return { matchId: target.matchId, competitionId: target.competitionId, kickoffAt: target.kickoffAt,
      oddsInputHash: analysis.inputHash, oddsItems: analysis.items } satisfies PredictionTarget;
  });
  const report = runPredictionBacktest(reconstructed, examples, config);
  return { ...report, postKickoffSnapshotsExcluded, afterSimulatedLockSnapshotsExcluded,
    postKickoffLeakageViolations, decisionTimeLeakageViolations,
    status: report.officialSimulatedPredictions > 0 && report.settledPredictions > 0 ? 'PASS' : 'PARTIAL' };
}
