import { createHash } from 'node:crypto';
import { calculateConsensus } from './consensus.js';
import { configHash, defaultConfig, validateConfig } from './config.js';
import { buildBookmakerMarkets } from './movement.js';
import { calculateDataQuality, calculateModelConfidence, freshnessMinutes } from './quality.js';
import type { AnalysisConfig, AnalysisItem, CornerMarketComparison, DataQuality, ModelConfidence, MovementClass,
  OddsAnalysis, OddsSnapshot, ScoreComponents } from './types.js';

function round(value: number, digits = 4): number { return Number(value.toFixed(digits)); }

function stableSnapshotHash(snapshots: OddsSnapshot[], hash: string, kickoffAt: Date,
  cornerComparison?: CornerMarketComparison): string {
  const payload = snapshots.map((item) => [item.provider, item.marketType, item.marketName, item.line,
    item.selection, item.oddsDecimal, item.capturedAt.toISOString()])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash('sha256').update(JSON.stringify({ configHash: hash, kickoffAt: kickoffAt.toISOString(),
    cornerComparison: cornerComparison ?? null, snapshots: payload })).digest('hex');
}

export function classifyMovement(deltaPp: number, agreement: number, dispersion: number,
  config: AnalysisConfig = defaultConfig): MovementClass {
  if (agreement < config.minimumAgreementRatio || dispersion > config.maximumDispersionPp) return 'NEUTRAL';
  if (deltaPp >= config.strongProbabilityChangePp) return 'STRONG_SUPPORT';
  if (deltaPp >= config.minimumProbabilityChangePp) return 'SUPPORT';
  if (deltaPp <= -config.strongProbabilityChangePp) return 'STRONG_OPPOSE';
  if (deltaPp <= -config.minimumProbabilityChangePp) return 'OPPOSE';
  return 'NEUTRAL';
}

function scoreComponents(consensus: ReturnType<typeof calculateConsensus>, cutoff: Date,
  config: AnalysisConfig): ScoreComponents {
  const movementRatio = Math.min(1, Math.abs(consensus.medianProbabilityDeltaPp) / config.strongProbabilityChangePp);
  const coverageRatio = Math.min(1, consensus.bookmakerCount / config.targetBookmakerCount);
  const freshnessRatio = Math.max(0, 1 - freshnessMinutes(consensus.latestCapturedAt, cutoff) / config.staleSnapshotMinutes);
  const stabilityRatio = Math.max(0, 1 - consensus.probabilityDispersion / config.maximumDispersionPp);
  return {
    movement: round(movementRatio * config.scoreWeights.movement, 2),
    agreement: round(consensus.movementAgreementRatio * config.scoreWeights.agreement, 2),
    coverage: round(coverageRatio * config.scoreWeights.coverage, 2),
    freshness: round(freshnessRatio * config.scoreWeights.freshness, 2),
    stability: round(stabilityRatio * config.scoreWeights.stability, 2),
  };
}

function cornerGap(item: { marketType: string; line: number | null; selection: string; currentFairProbability: number },
  comparison?: CornerMarketComparison): number | null {
  if (!comparison || comparison.qualityGrade === 'POOR' || item.line == null || !/CORNER/i.test(item.marketType)) return null;
  const probabilities = comparison.probabilities[String(item.line)];
  if (!probabilities) return null;
  const model = item.selection === 'OVER' ? probabilities.over : item.selection === 'UNDER' ? probabilities.under : null;
  return model == null ? null : round((model - item.currentFairProbability) * 100, 3);
}

function aggregateQuality(items: AnalysisItem[]): DataQuality {
  if (!items.length) return { score: 0, grade: 'POOR', analysisEligible: false, warnings: ['no complete pre-match markets'] };
  const lowest = items.reduce((left, right) => left.dataQuality.score <= right.dataQuality.score ? left : right);
  return { ...lowest.dataQuality, warnings: [...new Set(items.flatMap((item) => item.warnings))] };
}

function aggregateConfidence(items: AnalysisItem[], config: AnalysisConfig): ModelConfidence {
  if (!items.length) return { score: 0, grade: 'POOR' };
  const score = Math.round(items.reduce((sum, item) => sum + item.modelConfidence.score, 0) / items.length);
  const grade = score >= config.confidenceGoodThreshold ? 'GOOD'
    : score >= config.confidenceLimitedThreshold ? 'LIMITED' : 'POOR';
  return { score, grade };
}

export function analyzeOdds(matchId: string, kickoffAt: Date, snapshots: OddsSnapshot[],
  options: { config?: AnalysisConfig; generatedAt?: Date; cornerComparison?: CornerMarketComparison } = {}): OddsAnalysis {
  const config = validateConfig(options.config);
  const generatedAt = options.generatedAt ?? new Date();
  const cutoff = new Date(Math.min(generatedAt.getTime(), kickoffAt.getTime()));
  const valid = snapshots.filter((snapshot) => snapshot.matchId === matchId && Number.isFinite(snapshot.oddsDecimal)
    && snapshot.oddsDecimal > 1 && snapshot.capturedAt < kickoffAt && snapshot.capturedAt <= generatedAt);
  const excludedAfterKickoff = snapshots.filter((snapshot) => snapshot.matchId === matchId && snapshot.capturedAt >= kickoffAt).length;
  const markets = buildBookmakerMarkets(valid);
  const movements = markets.flatMap((market) => market.movements);
  const groups = new Map<string, typeof movements>();
  for (const movement of movements) {
    const key = JSON.stringify([movement.marketType, movement.marketName, movement.line, movement.selection]);
    groups.set(key, [...(groups.get(key) ?? []), movement]);
  }
  const items = [...groups.values()].map((votes): AnalysisItem => {
    const first = votes[0]!;
    const consensus = calculateConsensus(votes);
    const quality = calculateDataQuality(consensus, cutoff, config);
    const confidence = calculateModelConfidence(consensus, config);
    const components = scoreComponents(consensus, cutoff, config);
    const score = round(Object.values(components).reduce((sum, value) => sum + value, 0), 2);
    const movementClass = classifyMovement(consensus.medianProbabilityDeltaPp, consensus.movementAgreementRatio,
      consensus.probabilityDispersion, config);
    const probabilityDirection = consensus.medianProbabilityDeltaPp > 0 ? 'rose'
      : consensus.medianProbabilityDeltaPp < 0 ? 'fell' : 'was unchanged';
    const oddsDirection = consensus.medianCurrentOdds < consensus.medianOpeningOdds ? 'FALLING'
      : consensus.medianCurrentOdds > consensus.medianOpeningOdds ? 'RISING' : 'UNCHANGED';
    const reasons = [
      `${consensus.agreeingBookmakerCount}/${consensus.bookmakerCount} bookmakers agree with the ${first.selection} movement`,
      `median fair probability ${probabilityDirection} by ${Math.abs(consensus.medianProbabilityDeltaPp).toFixed(2)} percentage points`,
      `ODDS: ${oddsDirection}; MARKET PROBABILITY: ${consensus.medianProbabilityDeltaPp > 0 ? 'RISING' : consensus.medianProbabilityDeltaPp < 0 ? 'FALLING' : 'UNCHANGED'}`,
      `latest snapshot is ${Math.round(freshnessMinutes(consensus.latestCapturedAt, cutoff))} minutes old`,
    ];
    const gap = cornerGap({ marketType: first.marketType, line: first.line, selection: first.selection,
      currentFairProbability: consensus.medianCurrentFairProbability }, options.cornerComparison);
    const warnings = [...quality.warnings];
    if (excludedAfterKickoff) warnings.push(`${excludedAfterKickoff} snapshot(s) at/after kickoff were excluded`);
    if (/CORNER/i.test(first.marketType) && gap == null && options.cornerComparison) {
      warnings.push('Corner Engine comparison unavailable or limited');
    }
    return {
      marketType: first.marketType, marketName: first.marketName, line: first.line, selection: first.selection,
      openingOdds: round(consensus.medianOpeningOdds), currentOdds: round(consensus.medianCurrentOdds),
      highestOdds: round(consensus.highestOdds), lowestOdds: round(consensus.lowestOdds), snapshotCount: consensus.snapshotCount,
      openingFairProbability: round(consensus.medianOpeningFairProbability, 6),
      currentFairProbability: round(consensus.medianCurrentFairProbability, 6),
      probabilityDeltaPp: round(consensus.medianProbabilityDeltaPp, 4),
      rawOddsMovementPercent: round(((consensus.medianCurrentOdds - consensus.medianOpeningOdds)
        / consensus.medianOpeningOdds) * 100, 4), bookmakerCount: consensus.bookmakerCount,
      agreeingBookmakerCount: consensus.agreeingBookmakerCount,
      disagreeingBookmakerCount: consensus.disagreeingBookmakerCount,
      movementAgreementRatio: round(consensus.movementAgreementRatio, 4),
      probabilityDispersion: round(consensus.probabilityDispersion, 4), oddsDispersion: round(consensus.oddsDispersion, 4),
      movementClass, score, scoreComponents: components, dataQuality: quality, modelConfidence: confidence,
      analysisEligible: quality.analysisEligible, reasons, warnings, modelMarketGapPp: gap,
    };
  }).sort((left, right) => `${left.marketType}:${left.marketName}:${left.line}:${left.selection}`
    .localeCompare(`${right.marketType}:${right.marketName}:${right.line}:${right.selection}`));
  const hash = configHash(config);
  const quality = aggregateQuality(items);
  const confidence = aggregateConfidence(items, config);
  return {
    matchId, kickoffAt, generatedAt, modelVersion: config.modelVersion, configHash: hash,
    inputHash: stableSnapshotHash(valid, hash, kickoffAt, options.cornerComparison), dataQuality: quality,
    modelConfidence: confidence,
    analysisEligible: items.some((item) => item.analysisEligible), items,
    metadata: { safeSnapshotCount: valid.length, excludedAfterKickoff,
      incompleteMarketCount: markets.filter((market) => !market.complete).length,
      latestSnapshotAt: valid.length
        ? new Date(Math.max(...valid.map((snapshot) => snapshot.capturedAt.getTime()))).toISOString() : null,
      executionAuthority: false },
  };
}

// Kept for compatibility with the first ODDS_V1 draft.
export function analyzeMatch(matchId: string, snapshots: OddsSnapshot[], config: AnalysisConfig = defaultConfig): OddsAnalysis {
  return analyzeOdds(matchId, new Date(8_640_000_000_000_000), snapshots, { config });
}
