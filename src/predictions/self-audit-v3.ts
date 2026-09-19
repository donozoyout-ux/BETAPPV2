import { createHash } from 'node:crypto';
import type { SettlementOutcome } from './types.js';

export type RootCauseStatus = 'INSUFFICIENT_DATA' | 'HEALTHY' | 'WATCH' | 'HIGH_RISK';
export type RootCauseDimension =
  | 'PREDICTION_SCORE'
  | 'BOOKMAKER_COUNT'
  | 'HISTORICAL_SAMPLE'
  | 'DATA_QUALITY_GRADE'
  | 'CONFIDENCE_GRADE'
  | 'MOVEMENT_CLASS'
  | 'AGREEMENT_RATIO';

export type RootCauseConfig = {
  version: 'SELF_AUDIT_V3';
  recentWindow: number;
  minimumBaselineBinarySample: number;
  minimumBucketBinarySample: number;
  strongEvidenceBinarySample: number;
  watchPositiveRateGapBelow: number;
  highRiskPositiveRateGapBelow: number;
  watchReferencePaperRoiGapBelow: number;
  highRiskReferencePaperRoiGapBelow: number;
  severeAbsolutePositiveRateBelow: number;
  severeAbsoluteReferencePaperRoiBelow: number;
};

export const selfAuditV3Config: RootCauseConfig = {
  version: 'SELF_AUDIT_V3',
  recentWindow: 60,
  minimumBaselineBinarySample: 30,
  minimumBucketBinarySample: 12,
  strongEvidenceBinarySample: 30,
  watchPositiveRateGapBelow: -0.10,
  highRiskPositiveRateGapBelow: -0.18,
  watchReferencePaperRoiGapBelow: -0.10,
  highRiskReferencePaperRoiGapBelow: -0.20,
  severeAbsolutePositiveRateBelow: 0.30,
  severeAbsoluteReferencePaperRoiBelow: -0.25,
};

export type RootCauseRecord = {
  settlementId: string;
  settledAt: Date;
  outcome: SettlementOutcome;
  referencePaperReturn: number;
  historicalHitRate: number | null;
  predictionScore: number | null;
  bookmakerCount: number | null;
  historicalSampleSize: number;
  dataQualityGrade: string | null;
  confidenceGrade: string | null;
  movementClass: string | null;
  agreementRatio: number | null;
};

export type RootCauseReport = {
  version: 'SELF_AUDIT_V3';
  configHash: string;
  inputHash: string;
  evaluatedAt: Date;
  dimension: RootCauseDimension;
  bucketKey: string;
  bucketLabel: string;
  status: RootCauseStatus;
  settledSampleSize: number;
  binarySampleSize: number;
  positiveRate: number | null;
  referencePaperRoi: number | null;
  calibrationGap: number | null;
  calibrationSampleSize: number;
  baselineBinarySampleSize: number;
  baselinePositiveRate: number | null;
  baselineReferencePaperRoi: number | null;
  positiveRateGap: number | null;
  referencePaperRoiGap: number | null;
  evidenceStrength: number;
  rootCauseScore: number;
  reasons: string[];
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

export function rootCauseConfigHash(config: RootCauseConfig = selfAuditV3Config): string {
  return createHash('sha256').update(JSON.stringify(stable(config))).digest('hex');
}

const isBinary = (outcome: SettlementOutcome) => !['PUSH', 'VOID'].includes(outcome);
const isPositive = (outcome: SettlementOutcome) => outcome === 'WIN' || outcome === 'HALF_WIN';

function positiveRate(rows: RootCauseRecord[]): number | null {
  const binary = rows.filter((row) => isBinary(row.outcome));
  return binary.length ? binary.filter((row) => isPositive(row.outcome)).length / binary.length : null;
}

function paperRoi(rows: RootCauseRecord[]): number | null {
  const nonVoid = rows.filter((row) => row.outcome !== 'VOID');
  return nonVoid.length ? nonVoid.reduce((sum, row) => sum + row.referencePaperReturn, 0) / nonVoid.length : null;
}

function calibrationGap(rows: RootCauseRecord[]): { gap: number | null; n: number } {
  const binary = rows.filter((row) => isBinary(row.outcome) && row.historicalHitRate != null);
  if (!binary.length) return { gap: null, n: 0 };
  const predicted = binary.reduce((sum, row) => sum + Math.max(0, Math.min(1, row.historicalHitRate ?? 0)), 0) / binary.length;
  const actual = binary.filter((row) => isPositive(row.outcome)).length / binary.length;
  return { gap: actual - predicted, n: binary.length };
}

function scoreBucket(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 75) return '70-74';
  if (value < 80) return '75-79';
  if (value < 85) return '80-84';
  if (value < 90) return '85-89';
  return '90+';
}

function bookmakerBucket(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= 3) return '3';
  if (value === 4) return '4';
  if (value === 5) return '5';
  return '6+';
}

function historicalBucket(value: number): string {
  if (value < 50) return '30-49';
  if (value < 100) return '50-99';
  return '100+';
}

function agreementBucket(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 0.67) return '<67%';
  if (value < 0.80) return '67-79%';
  if (value < 0.90) return '80-89%';
  return '90%+';
}

function factorValue(row: RootCauseRecord, dimension: RootCauseDimension): string | null {
  switch (dimension) {
    case 'PREDICTION_SCORE': return scoreBucket(row.predictionScore);
    case 'BOOKMAKER_COUNT': return bookmakerBucket(row.bookmakerCount);
    case 'HISTORICAL_SAMPLE': return historicalBucket(row.historicalSampleSize);
    case 'DATA_QUALITY_GRADE': return row.dataQualityGrade || null;
    case 'CONFIDENCE_GRADE': return row.confidenceGrade || null;
    case 'MOVEMENT_CLASS': return row.movementClass || null;
    case 'AGREEMENT_RATIO': return agreementBucket(row.agreementRatio);
  }
}

function bucketLabel(dimension: RootCauseDimension, value: string): string {
  const names: Record<RootCauseDimension, string> = {
    PREDICTION_SCORE: 'Prediction Score',
    BOOKMAKER_COUNT: 'Bookmaker',
    HISTORICAL_SAMPLE: 'Historical N',
    DATA_QUALITY_GRADE: 'Data Quality',
    CONFIDENCE_GRADE: 'Confidence',
    MOVEMENT_CLASS: 'Movement',
    AGREEMENT_RATIO: 'Agreement',
  };
  return `${names[dimension]}: ${value}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function evaluateRootCauses(
  records: RootCauseRecord[],
  evaluatedAt = new Date(),
  config: RootCauseConfig = selfAuditV3Config,
): RootCauseReport[] {
  const recent = [...records]
    .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime() || b.settlementId.localeCompare(a.settlementId))
    .filter((row) => row.outcome !== 'VOID')
    .slice(0, config.recentWindow);
  const baselineBinary = recent.filter((row) => isBinary(row.outcome));
  const baselinePositiveRate = positiveRate(recent);
  const baselineReferencePaperRoi = paperRoi(recent);
  const dimensions: RootCauseDimension[] = [
    'PREDICTION_SCORE','BOOKMAKER_COUNT','HISTORICAL_SAMPLE','DATA_QUALITY_GRADE',
    'CONFIDENCE_GRADE','MOVEMENT_CLASS','AGREEMENT_RATIO',
  ];
  const reports: RootCauseReport[] = [];

  for (const dimension of dimensions) {
    const groups = new Map<string, RootCauseRecord[]>();
    for (const row of recent) {
      const value = factorValue(row, dimension);
      if (value == null) continue;
      groups.set(value, [...(groups.get(value) ?? []), row]);
    }

    for (const [value, rows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const binary = rows.filter((row) => isBinary(row.outcome));
      const rate = positiveRate(rows);
      const roi = paperRoi(rows);
      const calibration = calibrationGap(rows);
      const positiveRateGap = rate == null || baselinePositiveRate == null ? null : rate - baselinePositiveRate;
      const referencePaperRoiGap = roi == null || baselineReferencePaperRoi == null ? null : roi - baselineReferencePaperRoi;
      const evidenceStrength = clamp01(binary.length / config.strongEvidenceBinarySample);
      const positiveDeficit = positiveRateGap == null ? 0 : clamp01(-positiveRateGap / Math.abs(config.highRiskPositiveRateGapBelow));
      const roiDeficit = referencePaperRoiGap == null ? 0 : clamp01(-referencePaperRoiGap / Math.abs(config.highRiskReferencePaperRoiGapBelow));
      const rootCauseScore = Math.round(100 * evidenceStrength * (0.6 * positiveDeficit + 0.4 * roiDeficit) * 100) / 100;

      let status: RootCauseStatus = 'HEALTHY';
      const reasons: string[] = [];
      if (baselineBinary.length < config.minimumBaselineBinarySample || binary.length < config.minimumBucketBinarySample) {
        status = 'INSUFFICIENT_DATA';
        reasons.push(baselineBinary.length < config.minimumBaselineBinarySample
          ? 'ROOT_CAUSE_BASELINE_SAMPLE_INSUFFICIENT' : 'ROOT_CAUSE_BUCKET_SAMPLE_INSUFFICIENT');
      } else {
        const severeRelative = positiveRateGap != null && referencePaperRoiGap != null
          && positiveRateGap <= config.highRiskPositiveRateGapBelow
          && referencePaperRoiGap <= config.highRiskReferencePaperRoiGapBelow;
        const severeAbsolute = rate != null && roi != null
          && rate <= config.severeAbsolutePositiveRateBelow
          && roi <= config.severeAbsoluteReferencePaperRoiBelow;
        const watchRelative = positiveRateGap != null && referencePaperRoiGap != null
          && positiveRateGap <= config.watchPositiveRateGapBelow
          && referencePaperRoiGap <= config.watchReferencePaperRoiGapBelow;

        if (severeRelative || severeAbsolute) {
          status = 'HIGH_RISK';
          if (severeRelative) reasons.push('ROOT_CAUSE_RELATIVE_UNDERPERFORMANCE_HIGH');
          if (severeAbsolute) reasons.push('ROOT_CAUSE_ABSOLUTE_PERFORMANCE_HIGH');
        } else if (watchRelative) {
          status = 'WATCH';
          reasons.push('ROOT_CAUSE_RELATIVE_UNDERPERFORMANCE_WATCH');
        }
      }

      const inputHash = createHash('sha256').update(JSON.stringify(stable({
        version: config.version,
        configHash: rootCauseConfigHash(config),
        dimension,
        bucket: value,
        settlements: rows.map((row) => ({
          settlementId: row.settlementId,
          outcome: row.outcome,
          referencePaperReturn: row.referencePaperReturn,
          historicalHitRate: row.historicalHitRate,
          factor: factorValue(row, dimension),
        })),
      }))).digest('hex');

      reports.push({
        version: config.version,
        configHash: rootCauseConfigHash(config),
        inputHash,
        evaluatedAt,
        dimension,
        bucketKey: value,
        bucketLabel: bucketLabel(dimension, value),
        status,
        settledSampleSize: rows.length,
        binarySampleSize: binary.length,
        positiveRate: rate,
        referencePaperRoi: roi,
        calibrationGap: calibration.gap,
        calibrationSampleSize: calibration.n,
        baselineBinarySampleSize: baselineBinary.length,
        baselinePositiveRate,
        baselineReferencePaperRoi,
        positiveRateGap,
        referencePaperRoiGap,
        evidenceStrength,
        rootCauseScore,
        reasons,
      });
    }
  }

  const severity = (status: RootCauseStatus) =>
    status === 'HIGH_RISK' ? 0 : status === 'WATCH' ? 1 : status === 'HEALTHY' ? 2 : 3;
  return reports.sort((a, b) => severity(a.status) - severity(b.status)
    || b.rootCauseScore - a.rootCauseScore
    || b.binarySampleSize - a.binarySampleSize
    || a.bucketLabel.localeCompare(b.bucketLabel));
}
