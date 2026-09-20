import { evidenceGaps } from './baseline.js';
import { oddsNeighborConfig, type OddsNeighborConfig } from './config.js';
import { routeDistance } from './distance.js';
import type { ConflictCheck, EvidenceStrength, HistoricalNeighborInput, HistoricalTwin, MatchOutcomeData, OddsIntelligence, OddsRoute, SearchOptions } from './types.js';

export function findPastTwins(target: { competitionId: string; route: OddsRoute }, candidates: HistoricalNeighborInput[], options: SearchOptions,
  config: OddsNeighborConfig = oddsNeighborConfig): HistoricalTwin[] {
  const filtered = candidates.filter((candidate) => candidate.route.marketType === target.route.marketType && candidate.route.marketName === target.route.marketName
      && candidate.route.line === target.route.line && candidate.route.selection === target.route.selection);
  const band = options.bandPercent ?? config.defaultBandPercent;
  const lower = options.minimumOdds ?? target.route.openingOdds * (1 - band); const upper = options.maximumOdds ?? target.route.openingOdds * (1 + band);
  const scored = filtered.map((candidate) => ({ candidate, score: routeDistance(target.route, candidate.route, target.competitionId, candidate.competitionId, config) }))
    .filter((item): item is typeof item & { score: NonNullable<typeof item.score> } => item.score != null)
    .filter((item) => options.mode !== 'ODDS_BAND' || (item.candidate.route.openingOdds >= lower && item.candidate.route.openingOdds <= upper))
    .sort((a, b) => options.mode === 'CLOSEST_NEIGHBORS' ? a.score.distance - b.score.distance || a.candidate.kickoffAt.getTime() - b.candidate.kickoffAt.getTime() || a.candidate.matchId.localeCompare(b.candidate.matchId)
      : a.candidate.kickoffAt.getTime() - b.candidate.kickoffAt.getTime() || a.candidate.matchId.localeCompare(b.candidate.matchId))
    .slice(0, options.limit);
  return scored.map(({ candidate, score }, index) => ({ ...candidate, exampleId: candidate.matchId, distance: score.distance, similarity: score.similarity,
    matchedDimensions: score.matchedDimensions, differences: score.differences, openingOdds: candidate.route.openingOdds, decisionOdds: candidate.route.latestOdds,
    outcome: { home: candidate.homeScore, away: candidate.awayScore }, rank: index + 1 } as HistoricalTwin));
}

export function calculateEvidenceStrength(twins: HistoricalTwin[], gaps: Array<{ wilson: { lower: number | null; upper: number | null }; sampleSize: number }>, baselineSample: number): EvidenceStrength {
  if (!twins.length) return 'VERY_LOW';
  const average = twins.reduce((sum, item) => sum + item.similarity, 0) / twins.length; const top = twins[0]!.similarity;
  const width = Math.max(...gaps.map((item) => item.wilson.lower == null || item.wilson.upper == null ? 1 : item.wilson.upper - item.wilson.lower), 1);
  const completeness = gaps.length / 37;
  if (twins.length >= 50 && average >= 80 && top >= 85 && baselineSample >= 50 && width <= 0.25 && completeness >= 0.6) return 'HIGH';
  if (twins.length >= 20 && average >= 70 && baselineSample >= 20 && width <= 0.45 && completeness >= 0.35) return 'MEDIUM';
  return twins.length >= 5 ? 'LOW' : 'VERY_LOW';
}

function conflicts(route: OddsRoute, gaps: Array<{ gapPp: number | null }>): ConflictCheck[] {
  const twinGap = gaps.find((item) => 'market' in item && (item as { market?: string; selection?: string; line?: number | null }).market === route.marketType
    && (item as { selection?: string }).selection === route.selection && (item as { line?: number | null }).line === route.line)?.gapPp ?? null;
  return [
    { source: 'ODDS_TWINS', state: twinGap == null ? 'UNAVAILABLE' : twinGap >= 2 ? 'SUPPORT' : twinGap <= -2 ? 'CONFLICT' : 'NEUTRAL', reason: 'Geçmiş ikiz sonuç dağılımı ile taban karşılaştırması.' },
    { source: 'ODDS_ROUTE', state: route.direction === 'UP' && route.strength !== 'WEAK' ? 'SUPPORT' : route.direction === 'DOWN' && route.strength !== 'WEAK' ? 'CONFLICT' : 'NEUTRAL', reason: 'Yalnız gerçek pre-match odds snapshot rotası.' },
    { source: 'TEAM_HISTORICAL_STATS', state: 'UNAVAILABLE', reason: 'Bu V2 isteğinde takım profili bir karar girdisi değildir.' },
    { source: 'XG', state: 'UNAVAILABLE', reason: 'xG yalnız sonuç/context alanıdır; benzerlik veya karar girdisi değildir.' },
    { source: 'CORNERS_MODEL', state: 'UNAVAILABLE', reason: 'Korner modeli yalnız ilgili markette ayrı bir context kaynağı olarak eklenebilir.' },
  ];
}

export function buildOddsIntelligence(target: MatchOutcomeData & { route: OddsRoute }, candidates: HistoricalNeighborInput[], options: SearchOptions,
  generatedAt = new Date(), config: OddsNeighborConfig = oddsNeighborConfig): OddsIntelligence {
  const eligible = candidates.filter((item) => item.kickoffAt < target.kickoffAt);
  const twins = findPastTwins({ competitionId: target.competitionId, route: target.route }, eligible, options, config);
  const maps = evidenceGaps(twins, eligible, target.competitionId, config.minimumBaselineSample);
  const evidenceStrength = calculateEvidenceStrength(twins, maps, Math.max(0, ...maps.map((row) => row.baselineSampleSize)));
  return { match: { id: target.matchId, kickoffAt: target.kickoffAt, league: target.league, homeTeam: target.homeTeam, awayTeam: target.awayTeam },
    primaryMarket: { marketType: target.route.marketType, marketName: target.route.marketName, line: target.route.line, selection: target.route.selection }, oddsRoute: target.route,
    searchMode: options.mode, pastTwins: twins, resultMap: maps, evidenceGap: maps, evidenceStrength, conflictCheck: conflicts(target.route, maps),
    dataCompleteness: { routeSnapshots: target.route.genuineObservations, neighbors: twins.length, resultRowsWithData: maps.length, resultRows: 37 }, generatedAt,
    executionAuthority: false, aiPredictionAuthority: false };
}
