import { createHash } from 'node:crypto';
import type { DistributionMode } from './types.js';

export type CornerModelConfig = {
  modelVersion: 'CORNER_V1';
  distribution: DistributionMode;
  overdispersionRatio: number;
  minimumDistributionSample: number;
  shrinkageSample: number;
  weights: {
    teamVenueFor: number;
    opponentVenueAgainst: number;
    teamLast5For: number;
    opponentLast5Against: number;
    teamLast10For: number;
    opponentLast10Against: number;
    teamSeasonFor: number;
    opponentSeasonAgainst: number;
    leagueBaseline: number;
  };
  h2hWeight: number;
  pressureFeatureEnabled: boolean;
  pressureWeight: number;
  pressureComponents: {
    shots: number;
    shotsOnTarget: number;
    possession: number;
  };
  minimumEligibleQuality: number;
};

export const cornerModelConfig: CornerModelConfig = {
  modelVersion: 'CORNER_V1', distribution: 'AUTO', overdispersionRatio: 1.15,
  minimumDistributionSample: 20, shrinkageSample: 10,
  weights: {
    teamVenueFor: 0.20, opponentVenueAgainst: 0.20,
    teamLast5For: 0.10, opponentLast5Against: 0.10,
    teamLast10For: 0.10, opponentLast10Against: 0.10,
    teamSeasonFor: 0.05, opponentSeasonAgainst: 0.05, leagueBaseline: 0.10,
  },
  h2hWeight: 0.05, pressureFeatureEnabled: false, pressureWeight: 0.03,
  pressureComponents: { shots: 0.04, shotsOnTarget: 0.08, possession: 0.006 },
  minimumEligibleQuality: 45,
};

export function validateCornerConfig(config: CornerModelConfig) {
  const sum = Object.values(config.weights).reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`Corner weights must sum to 1; received ${sum}`);
  if (config.h2hWeight < 0 || config.h2hWeight > 0.10) throw new Error('h2hWeight must be between 0 and 0.10');
  if (config.pressureWeight < 0 || config.pressureWeight > 0.10) throw new Error('pressureWeight must be between 0 and 0.10');
  if (Object.values(config.pressureComponents).some((value) => value < 0)) {
    throw new Error('pressure component weights must be non-negative');
  }
}

export function configHash(config: CornerModelConfig): string {
  validateCornerConfig(config);
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
