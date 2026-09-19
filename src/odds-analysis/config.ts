import { createHash } from 'node:crypto';
import type { AnalysisConfig } from './types.js';

// Engineering defaults for V1. They are intentionally centralized and require backtest validation.
export const defaultConfig: AnalysisConfig = {
  modelVersion: 'ODDS_V1',
  minimumBookmakerCount: 3,
  targetBookmakerCount: 5,
  minimumSnapshotCount: 2,
  minimumProbabilityChangePp: 2,
  strongProbabilityChangePp: 5,
  maximumDispersionPp: 4,
  staleSnapshotMinutes: 180,
  minimumAgreementRatio: 0.6,
  confidenceGoodThreshold: 75,
  confidenceLimitedThreshold: 45,
  qualityGoodThreshold: 75,
  qualityLimitedThreshold: 50,
  scoreWeights: { movement: 30, agreement: 30, coverage: 15, freshness: 15, stability: 10 },
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function configHash(config: AnalysisConfig = defaultConfig): string {
  return createHash('sha256').update(JSON.stringify(stable(config))).digest('hex');
}

export function validateConfig(overrides: Partial<AnalysisConfig> = {}): AnalysisConfig {
  const config: AnalysisConfig = { ...defaultConfig, ...overrides,
    scoreWeights: { ...defaultConfig.scoreWeights, ...overrides.scoreWeights } };
  const numeric = Object.values(config).filter((value): value is number => typeof value === 'number');
  if (numeric.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('ODDS_V1 config values must be finite and non-negative');
  }
  if (Object.values(config.scoreWeights).reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error('ODDS_V1 score weights must sum to 100');
  }
  if (config.minimumAgreementRatio > 1) throw new Error('minimumAgreementRatio must be between 0 and 1');
  return config;
}
