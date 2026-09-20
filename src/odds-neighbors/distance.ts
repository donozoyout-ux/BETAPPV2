import { oddsNeighborConfig, type OddsNeighborConfig } from './config.js';
import type { OddsRoute } from './types.js';

export type RouteDistance = { distance: number; similarity: number; matchedDimensions: string[]; differences: Record<string, number> };
function normalizedDifference(left: number, right: number, scale: number): number { return Math.min(1, Math.abs(left - right) / scale); }

/** Exact identity is a mandatory gate; scored dimensions are all pre-kickoff route features. */
export function routeDistance(target: OddsRoute, candidate: OddsRoute, targetCompetitionId: string, candidateCompetitionId: string,
  config: OddsNeighborConfig = oddsNeighborConfig): RouteDistance | null {
  if (target.marketType !== candidate.marketType || target.marketName !== candidate.marketName || target.line !== candidate.line || target.selection !== candidate.selection) return null;
  const scales = config.distanceScales;
  const differences: Record<string, number> = {
    openingFairProbability: normalizedDifference(target.openingFairProbability, candidate.openingFairProbability, scales.openingFair),
    latestFairProbability: normalizedDifference(target.latestFairProbability, candidate.latestFairProbability, scales.latestFair),
    totalMovementPp: normalizedDifference(target.totalMovementPp, candidate.totalMovementPp, scales.movementPp),
    openingOdds: normalizedDifference(target.openingOdds, candidate.openingOdds, scales.openingOdds),
    latestOdds: normalizedDifference(target.latestOdds, candidate.latestOdds, scales.latestOdds),
    bookmakerAgreement: normalizedDifference(target.bookmakerAgreement, candidate.bookmakerAgreement, scales.agreement),
    bookmakerCount: normalizedDifference(target.bookmakers.length, candidate.bookmakers.length, scales.bookmakerCount),
    velocity: normalizedDifference(target.velocityPpPerHour, candidate.velocityPpPerHour, scales.velocity),
    monotonicity: normalizedDifference(target.monotonicityRatio, candidate.monotonicityRatio, scales.monotonicity),
    competition: targetCompetitionId === candidateCompetitionId ? 0 : 1,
  };
  const values = Object.values(differences); const distance = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { distance: Number(distance.toFixed(6)), similarity: Number((100 * (1 - distance)).toFixed(2)),
    matchedDimensions: Object.entries(differences).filter(([, value]) => value <= 0.1).map(([key]) => key), differences };
}
