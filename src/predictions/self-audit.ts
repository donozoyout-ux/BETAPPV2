import { createHash } from 'node:crypto';
import type { SettlementOutcome } from './types.js';

export type SelfAuditStatus = 'INSUFFICIENT_DATA' | 'HEALTHY' | 'WATCH' | 'PAUSED';

export type SelfAuditConfig = {
  version: 'SELF_AUDIT_V1';
  recentWindow: number;
  minimumBinarySample: number;
  minimumRecentBinarySample: number;
  minimumCalibrationSample: number;
  watchPositiveRateBelow: number;
  pausePositiveRateBelow: number;
  watchReferencePaperRoiBelow: number;
  pauseReferencePaperRoiBelow: number;
  watchCalibrationMaeAbove: number;
  pauseCalibrationMaeAbove: number;
  watchLossStreak: number;
  pauseLossStreak: number;
};

export const selfAuditConfig: SelfAuditConfig = {
  version: 'SELF_AUDIT_V1',
  recentWindow: 40,
  minimumBinarySample: 30,
  minimumRecentBinarySample: 20,
  minimumCalibrationSample: 20,
  watchPositiveRateBelow: 0.48,
  pausePositiveRateBelow: 0.40,
  watchReferencePaperRoiBelow: -0.10,
  pauseReferencePaperRoiBelow: -0.20,
  watchCalibrationMaeAbove: 0.25,
  pauseCalibrationMaeAbove: 0.35,
  watchLossStreak: 5,
  pauseLossStreak: 8,
};

export type SelfAuditRecord = {
  settlementId: string;
  settledAt: Date;
  outcome: SettlementOutcome;
  referencePaperReturn: number;
  historicalHitRate: number | null;
};

export type SelfAuditReport = {
  version: 'SELF_AUDIT_V1';
  configHash: string;
  inputHash: string;
  evaluatedAt: Date;
  status: SelfAuditStatus;
  settledSampleSize: number;
  binarySampleSize: number;
  recentSampleSize: number;
  recentBinarySampleSize: number;
  recentPositiveRate: number | null;
  recentReferencePaperRoi: number | null;
  calibrationMae: number | null;
  calibrationSampleSize: number;
  lossStreak: number;
  reasons: string[];
  metrics: {
    recentWins: number;
    recentHalfWins: number;
    recentPushes: number;
    recentHalfLosses: number;
    recentLosses: number;
    recentVoids: number;
  };
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function selfAuditConfigHash(config: SelfAuditConfig = selfAuditConfig): string {
  return createHash('sha256').update(JSON.stringify(stable(config))).digest('hex');
}

const isBinary = (outcome: SettlementOutcome) => !['PUSH', 'VOID'].includes(outcome);
const isPositive = (outcome: SettlementOutcome) => outcome === 'WIN' || outcome === 'HALF_WIN';
const isNegative = (outcome: SettlementOutcome) => outcome === 'LOSS' || outcome === 'HALF_LOSS';

function outcomeCount(rows: SelfAuditRecord[], outcome: SettlementOutcome) {
  return rows.filter((row) => row.outcome === outcome).length;
}

export function evaluateSelfAudit(
  records: SelfAuditRecord[],
  evaluatedAt = new Date(),
  config: SelfAuditConfig = selfAuditConfig,
): SelfAuditReport {
  const sorted = [...records].sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime() || b.settlementId.localeCompare(a.settlementId));
  const nonVoid = sorted.filter((row) => row.outcome !== 'VOID');
  const binary = nonVoid.filter((row) => isBinary(row.outcome));
  const recent = nonVoid.slice(0, config.recentWindow);
  const recentBinary = recent.filter((row) => isBinary(row.outcome));
  const positives = recentBinary.filter((row) => isPositive(row.outcome)).length;
  const recentPositiveRate = recentBinary.length ? positives / recentBinary.length : null;
  const recentReferencePaperRoi = recent.length
    ? recent.reduce((sum, row) => sum + row.referencePaperReturn, 0) / recent.length
    : null;
  const calibrationRows = recentBinary.filter((row) => row.historicalHitRate != null);
  const calibrationBuckets = new Map<number, SelfAuditRecord[]>();
  for (const row of calibrationRows) {
    const probability = Math.max(0, Math.min(1, row.historicalHitRate ?? 0));
    const bucket = Math.min(9, Math.floor(probability * 10));
    calibrationBuckets.set(bucket, [...(calibrationBuckets.get(bucket) ?? []), row]);
  }
  const calibrationMae = calibrationRows.length
    ? [...calibrationBuckets.values()].reduce((weightedError, rows) => {
      const predicted = rows.reduce((sum, row) => sum + (row.historicalHitRate ?? 0), 0) / rows.length;
      const actual = rows.filter((row) => isPositive(row.outcome)).length / rows.length;
      return weightedError + Math.abs(predicted - actual) * rows.length;
    }, 0) / calibrationRows.length
    : null;

  let lossStreak = 0;
  for (const row of nonVoid) {
    if (row.outcome === 'PUSH') continue;
    if (isNegative(row.outcome)) { lossStreak += 1; continue; }
    break;
  }

  const reasons: string[] = [];
  let status: SelfAuditStatus = 'HEALTHY';

  if (binary.length < config.minimumBinarySample) {
    status = 'INSUFFICIENT_DATA';
    reasons.push('SELF_AUDIT_MIN_SAMPLE_NOT_REACHED');
  } else {
    const recentPerformanceReady = recentBinary.length >= config.minimumRecentBinarySample;
    const pauseForPerformance = recentPerformanceReady && recentPositiveRate != null && recentReferencePaperRoi != null
      && recentPositiveRate < config.pausePositiveRateBelow
      && recentReferencePaperRoi < config.pauseReferencePaperRoiBelow;
    const pauseForCalibration = calibrationRows.length >= config.minimumCalibrationSample
      && calibrationMae != null && calibrationMae > config.pauseCalibrationMaeAbove;
    if (lossStreak >= config.pauseLossStreak) reasons.push('SELF_AUDIT_LOSS_STREAK_PAUSE');
    if (pauseForPerformance) reasons.push('SELF_AUDIT_RECENT_PERFORMANCE_PAUSE');
    if (pauseForCalibration) reasons.push('SELF_AUDIT_CALIBRATION_PAUSE');

    if (reasons.length) {
      status = 'PAUSED';
    } else {
      const watchForPerformance = recentPerformanceReady && ((recentPositiveRate != null && recentPositiveRate < config.watchPositiveRateBelow)
        || (recentReferencePaperRoi != null && recentReferencePaperRoi < config.watchReferencePaperRoiBelow));
      const watchForCalibration = calibrationRows.length >= config.minimumCalibrationSample
        && calibrationMae != null && calibrationMae > config.watchCalibrationMaeAbove;
      if (lossStreak >= config.watchLossStreak) reasons.push('SELF_AUDIT_LOSS_STREAK_WATCH');
      if (watchForPerformance) reasons.push('SELF_AUDIT_RECENT_PERFORMANCE_WATCH');
      if (watchForCalibration) reasons.push('SELF_AUDIT_CALIBRATION_WATCH');
      if (reasons.length) status = 'WATCH';
    }
  }

  const inputHash = createHash('sha256').update(JSON.stringify(stable({
    configHash: selfAuditConfigHash(config),
    records: sorted.map((row) => ({
      settlementId: row.settlementId,
      settledAt: row.settledAt.toISOString(),
      outcome: row.outcome,
      referencePaperReturn: row.referencePaperReturn,
      historicalHitRate: row.historicalHitRate,
    })),
  }))).digest('hex');

  return {
    version: config.version,
    configHash: selfAuditConfigHash(config),
    inputHash,
    evaluatedAt,
    status,
    settledSampleSize: nonVoid.length,
    binarySampleSize: binary.length,
    recentSampleSize: recent.length,
    recentBinarySampleSize: recentBinary.length,
    recentPositiveRate,
    recentReferencePaperRoi,
    calibrationMae,
    calibrationSampleSize: calibrationRows.length,
    lossStreak,
    reasons,
    metrics: {
      recentWins: outcomeCount(recent, 'WIN'),
      recentHalfWins: outcomeCount(recent, 'HALF_WIN'),
      recentPushes: outcomeCount(recent, 'PUSH'),
      recentHalfLosses: outcomeCount(recent, 'HALF_LOSS'),
      recentLosses: outcomeCount(recent, 'LOSS'),
      recentVoids: outcomeCount(sorted.slice(0, config.recentWindow), 'VOID'),
    },
  };
}
