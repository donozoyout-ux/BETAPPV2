export type OddsNeighborConfig = {
  version: 'ODDS_NEIGHBOR_V2'; closestLimit: number; bandLimit: number; defaultBandPercent: number;
  minimumBaselineSample: number; minimumTwinSimilarity: number; minimumEvidenceSample: number;
  routeStrongPp: number; routeModeratePp: number;
  distanceScales: { openingFair: number; latestFair: number; movementPp: number; openingOdds: number; latestOdds: number; agreement: number; bookmakerCount: number; velocity: number; monotonicity: number; competition: number };
};

export const oddsNeighborConfig: OddsNeighborConfig = {
  version: 'ODDS_NEIGHBOR_V2', closestLimit: 20, bandLimit: 100, defaultBandPercent: 0.05,
  minimumBaselineSample: 20, minimumTwinSimilarity: 70, minimumEvidenceSample: 5,
  routeStrongPp: 5, routeModeratePp: 2,
  distanceScales: { openingFair: 0.12, latestFair: 0.12, movementPp: 8, openingOdds: 0.5, latestOdds: 0.5,
    agreement: 0.35, bookmakerCount: 4, velocity: 4, monotonicity: 0.5, competition: 1 },
};
