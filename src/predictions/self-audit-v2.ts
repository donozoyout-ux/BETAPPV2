import { createHash } from 'node:crypto';
import { evaluateSelfAudit, selfAuditConfigHash, type SelfAuditConfig, type SelfAuditRecord, type SelfAuditReport } from './self-audit.js';

export type SegmentScope = 'MARKET' | 'LEAGUE' | 'LEAGUE_MARKET';

export type SegmentSelfAuditRecord = SelfAuditRecord & {
  competitionId: string;
  competitionName: string;
  marketType: string;
};

export type SegmentSelfAuditReport = SelfAuditReport & {
  scopeType: SegmentScope;
  segmentKey: string;
  competitionId: string | null;
  competitionName: string | null;
  marketType: string | null;
};

export const selfAuditV2Config: SelfAuditConfig = {
  version: 'SELF_AUDIT_V2',
  recentWindow: 24,
  minimumBinarySample: 12,
  minimumRecentBinarySample: 10,
  minimumCalibrationSample: 10,
  watchPositiveRateBelow: 0.45,
  pausePositiveRateBelow: 0.35,
  watchReferencePaperRoiBelow: -0.12,
  pauseReferencePaperRoiBelow: -0.25,
  watchCalibrationMaeAbove: 0.30,
  pauseCalibrationMaeAbove: 0.40,
  watchLossStreak: 4,
  pauseLossStreak: 5,
  pauseCooldownHours: 24,
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

export function segmentAuditConfigHash(config: SelfAuditConfig = selfAuditV2Config): string {
  return createHash('sha256').update(JSON.stringify(stable(config))).digest('hex');
}

export function marketSegmentKey(marketType: string) {
  return `MARKET:${marketType}`;
}

export function leagueSegmentKey(competitionId: string) {
  return `LEAGUE:${competitionId}`;
}

export function leagueMarketSegmentKey(competitionId: string, marketType: string) {
  return `LEAGUE_MARKET:${competitionId}:${marketType}`;
}

export function segmentKeysFor(competitionId: string, marketType: string): string[] {
  return [
    marketSegmentKey(marketType),
    leagueSegmentKey(competitionId),
    leagueMarketSegmentKey(competitionId, marketType),
  ];
}

function evaluateSegment(
  scopeType: SegmentScope,
  segmentKey: string,
  rows: SegmentSelfAuditRecord[],
  evaluatedAt: Date,
  config: SelfAuditConfig,
  competitionId: string | null,
  competitionName: string | null,
  marketType: string | null,
): SegmentSelfAuditReport {
  const base = evaluateSelfAudit(rows, evaluatedAt, config);
  return { ...base, scopeType, segmentKey, competitionId, competitionName, marketType };
}

export function evaluateSegmentSelfAudits(
  records: SegmentSelfAuditRecord[],
  evaluatedAt = new Date(),
  config: SelfAuditConfig = selfAuditV2Config,
): SegmentSelfAuditReport[] {
  const marketGroups = new Map<string, SegmentSelfAuditRecord[]>();
  const leagueGroups = new Map<string, SegmentSelfAuditRecord[]>();
  const leagueMarketGroups = new Map<string, SegmentSelfAuditRecord[]>();

  for (const row of records) {
    if (!row.marketType || !row.competitionId) continue;
    marketGroups.set(row.marketType, [...(marketGroups.get(row.marketType) ?? []), row]);
    leagueGroups.set(row.competitionId, [...(leagueGroups.get(row.competitionId) ?? []), row]);
    const combo = `${row.competitionId}\u0000${row.marketType}`;
    leagueMarketGroups.set(combo, [...(leagueMarketGroups.get(combo) ?? []), row]);
  }

  const reports: SegmentSelfAuditReport[] = [];

  for (const [marketType, rows] of [...marketGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    reports.push(evaluateSegment('MARKET', marketSegmentKey(marketType), rows, evaluatedAt, config,
      null, null, marketType));
  }

  for (const [competitionId, rows] of [...leagueGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const competitionName = rows.find((row) => row.competitionName)?.competitionName ?? competitionId;
    reports.push(evaluateSegment('LEAGUE', leagueSegmentKey(competitionId), rows, evaluatedAt, config,
      competitionId, competitionName, null));
  }

  for (const [combo, rows] of [...leagueMarketGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [competitionId = '', marketType = ''] = combo.split('\u0000');
    const competitionName = rows.find((row) => row.competitionName)?.competitionName ?? competitionId;
    reports.push(evaluateSegment('LEAGUE_MARKET', leagueMarketSegmentKey(competitionId, marketType), rows,
      evaluatedAt, config, competitionId, competitionName, marketType));
  }

  return reports;
}

export function segmentAuditInputHash(reports: SegmentSelfAuditReport[], config: SelfAuditConfig = selfAuditV2Config): string {
  return createHash('sha256').update(JSON.stringify(stable({
    configHash: selfAuditConfigHash(config),
    segments: reports.map((report) => ({ segmentKey: report.segmentKey, inputHash: report.inputHash })),
  }))).digest('hex');
}
