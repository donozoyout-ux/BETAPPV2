import { createHash } from 'node:crypto';
import type { PredictionConfig } from './config.js';
import {
  ROOT_CAUSE_DIMENSIONS,
  evaluateRootCauses,
  rootCauseBucketLabel,
  rootCauseFactorValue,
  type RootCauseDimension,
  type RootCauseRecord,
} from './self-audit-v3.js';
import type { SettlementOutcome } from './types.js';

export type AdaptiveProposalType = 'SINGLE_FACTOR_GUARD' | 'COMBINATION_GUARD';
export type AdaptiveProposalSeverity = 'WATCH' | 'HIGH_RISK';

export type AdaptiveRuleConfig = {
  version: 'SELF_AUDIT_V4';
  recentWindow: number;
  minimumBaselineBinarySample: number;
  minimumCombinationBinarySample: number;
  strongEvidenceBinarySample: number;
  proposalPositiveRateGapBelow: number;
  proposalReferencePaperRoiGapBelow: number;
  highRiskPositiveRateGapBelow: number;
  highRiskReferencePaperRoiGapBelow: number;
  interactionPositiveRateGapBelow: number;
  interactionReferencePaperRoiGapBelow: number;
  maximumProposals: number;
};

export const selfAuditV4Config: AdaptiveRuleConfig = {
  version: 'SELF_AUDIT_V4',
  recentWindow: 100,
  minimumBaselineBinarySample: 40,
  minimumCombinationBinarySample: 15,
  strongEvidenceBinarySample: 30,
  proposalPositiveRateGapBelow: -0.12,
  proposalReferencePaperRoiGapBelow: -0.12,
  highRiskPositiveRateGapBelow: -0.20,
  highRiskReferencePaperRoiGapBelow: -0.22,
  interactionPositiveRateGapBelow: -0.05,
  interactionReferencePaperRoiGapBelow: -0.08,
  maximumProposals: 20,
};

export type AdaptiveRuleCondition = {
  dimension: RootCauseDimension;
  bucketKey: string;
  bucketLabel: string;
};

export type AdaptiveRuleProposal = {
  version: 'SELF_AUDIT_V4';
  configHash: string;
  inputHash: string;
  evaluatedAt: Date;
  proposalKey: string;
  proposalType: AdaptiveProposalType;
  severity: AdaptiveProposalSeverity;
  title: string;
  conditions: AdaptiveRuleCondition[];
  suggestedChange: {
    kind: 'ADD_SKIP_RULE';
    operator: 'ALL';
    conditions: AdaptiveRuleCondition[];
    autoApply: false;
    executionAuthority: false;
  };
  binarySampleSize: number;
  positiveRate: number;
  referencePaperRoi: number;
  baselineBinarySampleSize: number;
  baselinePositiveRate: number;
  baselineReferencePaperRoi: number;
  positiveRateGap: number;
  referencePaperRoiGap: number;
  interactionPositiveRateGap: number | null;
  interactionReferencePaperRoiGap: number | null;
  evidenceStrength: number;
  proposalScore: number;
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

export function adaptiveRuleConfigHash(config: AdaptiveRuleConfig = selfAuditV4Config): string {
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function condition(dimension: RootCauseDimension, bucketKey: string): AdaptiveRuleCondition {
  return { dimension, bucketKey, bucketLabel: rootCauseBucketLabel(dimension, bucketKey) };
}

function proposalKey(conditions: AdaptiveRuleCondition[]): string {
  return conditions.map((item) => `${item.dimension}=${item.bucketKey}`).sort().join('&');
}

function makeInputHash(
  config: AdaptiveRuleConfig,
  predictionConfig: PredictionConfig,
  conditions: AdaptiveRuleCondition[],
  rows: RootCauseRecord[],
): string {
  return createHash('sha256').update(JSON.stringify(stable({
    version: config.version,
    configHash: adaptiveRuleConfigHash(config),
    predictionConfig,
    proposalKey: proposalKey(conditions),
    settlements: rows.map((row) => ({
      settlementId: row.settlementId,
      settledAt: row.settledAt.toISOString(),
      outcome: row.outcome,
      referencePaperReturn: row.referencePaperReturn,
      factorValues: Object.fromEntries(conditions.map((item) =>
        [item.dimension, rootCauseFactorValue(row, item.dimension)])),
    })),
  }))).digest('hex');
}

function scoreProposal(
  binarySampleSize: number,
  positiveRateGap: number,
  roiGap: number,
  interactionRateGap: number | null,
  interactionRoiGap: number | null,
  config: AdaptiveRuleConfig,
): number {
  const evidence = clamp01(binarySampleSize / config.strongEvidenceBinarySample);
  const rateDeficit = clamp01(-positiveRateGap / Math.abs(config.highRiskPositiveRateGapBelow));
  const roiDeficit = clamp01(-roiGap / Math.abs(config.highRiskReferencePaperRoiGapBelow));
  const interactionRate = interactionRateGap == null ? 0 : clamp01(-interactionRateGap / 0.15);
  const interactionRoi = interactionRoiGap == null ? 0 : clamp01(-interactionRoiGap / 0.20);
  return Math.round(100 * evidence * (0.45 * rateDeficit + 0.35 * roiDeficit + 0.10 * interactionRate + 0.10 * interactionRoi) * 100) / 100;
}

function buildProposal(args: {
  predictionConfig: PredictionConfig;
  config: AdaptiveRuleConfig;
  evaluatedAt: Date;
  proposalType: AdaptiveProposalType;
  conditions: AdaptiveRuleCondition[];
  rows: RootCauseRecord[];
  baselineBinarySampleSize: number;
  baselinePositiveRate: number;
  baselineReferencePaperRoi: number;
  positiveRate: number;
  referencePaperRoi: number;
  interactionPositiveRateGap: number | null;
  interactionReferencePaperRoiGap: number | null;
  reasons: string[];
}): AdaptiveRuleProposal {
  const positiveRateGap = args.positiveRate - args.baselinePositiveRate;
  const referencePaperRoiGap = args.referencePaperRoi - args.baselineReferencePaperRoi;
  const binarySampleSize = args.rows.filter((row) => isBinary(row.outcome)).length;
  const severe = positiveRateGap <= args.config.highRiskPositiveRateGapBelow
    && referencePaperRoiGap <= args.config.highRiskReferencePaperRoiGapBelow;
  const severity: AdaptiveProposalSeverity = severe ? 'HIGH_RISK' : 'WATCH';
  const key = proposalKey(args.conditions);
  const evidenceStrength = clamp01(binarySampleSize / args.config.strongEvidenceBinarySample);
  const score = scoreProposal(binarySampleSize, positiveRateGap, referencePaperRoiGap,
    args.interactionPositiveRateGap, args.interactionReferencePaperRoiGap, args.config);
  const labels = args.conditions.map((item) => item.bucketLabel).join(' + ');
  return {
    version: args.config.version,
    configHash: adaptiveRuleConfigHash(args.config),
    inputHash: makeInputHash(args.config, args.predictionConfig, args.conditions, args.rows),
    evaluatedAt: args.evaluatedAt,
    proposalKey: key,
    proposalType: args.proposalType,
    severity,
    title: args.proposalType === 'COMBINATION_GUARD'
      ? `Aday kombinasyon koruması: ${labels}`
      : `Aday faktör koruması: ${labels}`,
    conditions: args.conditions,
    suggestedChange: {
      kind: 'ADD_SKIP_RULE',
      operator: 'ALL',
      conditions: args.conditions,
      autoApply: false,
      executionAuthority: false,
    },
    binarySampleSize,
    positiveRate: args.positiveRate,
    referencePaperRoi: args.referencePaperRoi,
    baselineBinarySampleSize: args.baselineBinarySampleSize,
    baselinePositiveRate: args.baselinePositiveRate,
    baselineReferencePaperRoi: args.baselineReferencePaperRoi,
    positiveRateGap,
    referencePaperRoiGap,
    interactionPositiveRateGap: args.interactionPositiveRateGap,
    interactionReferencePaperRoiGap: args.interactionReferencePaperRoiGap,
    evidenceStrength,
    proposalScore: score,
    reasons: args.reasons,
  };
}

export function generateAdaptiveRuleProposals(
  records: RootCauseRecord[],
  predictionConfig: PredictionConfig,
  evaluatedAt = new Date(),
  config: AdaptiveRuleConfig = selfAuditV4Config,
): AdaptiveRuleProposal[] {
  const recent = [...records]
    .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime() || b.settlementId.localeCompare(a.settlementId))
    .filter((row) => row.outcome !== 'VOID')
    .slice(0, config.recentWindow);
  const baselineBinary = recent.filter((row) => isBinary(row.outcome));
  const baselinePositiveRate = positiveRate(recent);
  const baselineReferencePaperRoi = paperRoi(recent);
  if (baselineBinary.length < config.minimumBaselineBinarySample
    || baselinePositiveRate == null || baselineReferencePaperRoi == null) return [];

  const proposals: AdaptiveRuleProposal[] = [];

  // V3 high-risk single factors become explicit rule proposals only when evidence is strong enough.
  const rootCauses = evaluateRootCauses(recent, evaluatedAt);
  for (const report of rootCauses) {
    if (report.status !== 'HIGH_RISK' || report.binarySampleSize < config.minimumCombinationBinarySample) continue;
    const rows = recent.filter((row) => rootCauseFactorValue(row, report.dimension) === report.bucketKey);
    const rate = positiveRate(rows);
    const roi = paperRoi(rows);
    if (rate == null || roi == null) continue;
    proposals.push(buildProposal({
      predictionConfig, config, evaluatedAt, proposalType: 'SINGLE_FACTOR_GUARD',
      conditions: [condition(report.dimension, report.bucketKey)], rows,
      baselineBinarySampleSize: baselineBinary.length, baselinePositiveRate, baselineReferencePaperRoi,
      positiveRate: rate, referencePaperRoi: roi,
      interactionPositiveRateGap: null, interactionReferencePaperRoiGap: null,
      reasons: ['ADAPTIVE_SINGLE_FACTOR_HIGH_RISK', ...report.reasons],
    }));
  }

  for (let leftIndex = 0; leftIndex < ROOT_CAUSE_DIMENSIONS.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ROOT_CAUSE_DIMENSIONS.length; rightIndex += 1) {
      const left = ROOT_CAUSE_DIMENSIONS[leftIndex]!;
      const right = ROOT_CAUSE_DIMENSIONS[rightIndex]!;
      const groups = new Map<string, RootCauseRecord[]>();

      for (const row of recent) {
        const leftValue = rootCauseFactorValue(row, left);
        const rightValue = rootCauseFactorValue(row, right);
        if (leftValue == null || rightValue == null) continue;
        const key = `${leftValue}\u0000${rightValue}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }

      for (const [key, rows] of groups.entries()) {
        const binarySampleSize = rows.filter((row) => isBinary(row.outcome)).length;
        if (binarySampleSize < config.minimumCombinationBinarySample) continue;
        const [leftValue = '', rightValue = ''] = key.split('\u0000');
        const rate = positiveRate(rows);
        const roi = paperRoi(rows);
        if (rate == null || roi == null) continue;
        const positiveRateGap = rate - baselinePositiveRate;
        const roiGap = roi - baselineReferencePaperRoi;
        if (positiveRateGap > config.proposalPositiveRateGapBelow || roiGap > config.proposalReferencePaperRoiGapBelow) continue;

        const leftRows = recent.filter((row) => rootCauseFactorValue(row, left) === leftValue);
        const rightRows = recent.filter((row) => rootCauseFactorValue(row, right) === rightValue);
        const leftRate = positiveRate(leftRows);
        const rightRate = positiveRate(rightRows);
        const leftRoi = paperRoi(leftRows);
        const rightRoi = paperRoi(rightRows);
        if (leftRate == null || rightRate == null || leftRoi == null || rightRoi == null) continue;

        // Require evidence that the pair is worse than its weaker individual parent.
        // This prevents V4 from relabeling a single-factor problem as a novel interaction.
        const interactionPositiveRateGap = rate - Math.min(leftRate, rightRate);
        const interactionReferencePaperRoiGap = roi - Math.min(leftRoi, rightRoi);
        if (interactionPositiveRateGap > config.interactionPositiveRateGapBelow
          || interactionReferencePaperRoiGap > config.interactionReferencePaperRoiGapBelow) continue;

        proposals.push(buildProposal({
          predictionConfig, config, evaluatedAt, proposalType: 'COMBINATION_GUARD',
          conditions: [condition(left, leftValue), condition(right, rightValue)], rows,
          baselineBinarySampleSize: baselineBinary.length, baselinePositiveRate, baselineReferencePaperRoi,
          positiveRate: rate, referencePaperRoi: roi,
          interactionPositiveRateGap, interactionReferencePaperRoiGap,
          reasons: ['ADAPTIVE_COMBINATION_UNDERPERFORMANCE', 'ADAPTIVE_INTERACTION_CONFIRMED'],
        }));
      }
    }
  }

  const unique = new Map<string, AdaptiveRuleProposal>();
  for (const proposal of proposals) {
    const previous = unique.get(proposal.proposalKey);
    if (!previous || proposal.proposalScore > previous.proposalScore) unique.set(proposal.proposalKey, proposal);
  }
  return [...unique.values()]
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'HIGH_RISK' ? -1 : 1)
      || b.proposalScore - a.proposalScore || b.binarySampleSize - a.binarySampleSize
      || a.proposalKey.localeCompare(b.proposalKey))
    .slice(0, config.maximumProposals);
}
