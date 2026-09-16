export const providerCapabilities = [
  'FIXTURES', 'MATCH_RESULT', 'TEAM_INFO', 'LEAGUE_INFO', 'HISTORICAL_MATCHES',
  'GOALS', 'CORNERS', 'YELLOW_CARDS', 'RED_CARDS', 'FOULS', 'SHOTS',
  'SHOTS_ON_TARGET', 'POSSESSION', 'XG', 'LINEUPS', 'INJURIES', 'REFEREE', 'H2H',
  'PREMATCH_ODDS', 'LIVE_ODDS', 'ODDS_MARKETS',
] as const;

export type ProviderCapability = (typeof providerCapabilities)[number];
export type QualificationResult = 'SUPPORTED' | 'PARTIAL' | 'UNAVAILABLE' | 'BLOCKED' | 'NOT_TESTED';

export type CapabilityCheck = {
  capability: ProviderCapability;
  result: QualificationResult;
  source: string;
  checkedAt: Date;
  httpStatus: number | null;
  latencyMs: number;
  sampleCount: number;
  parseSuccess: boolean;
  error: string | null;
  notes: string | null;
};

export type ProviderQualification = {
  provider: string;
  connection: QualificationResult;
  checks: CapabilityCheck[];
};

export interface QualifiableProvider {
  readonly name: string;
  qualify(): Promise<ProviderQualification>;
}

export function notTestedChecks(provider: string, source: string): CapabilityCheck[] {
  const checkedAt = new Date();
  return providerCapabilities.map((capability) => ({
    capability, result: 'NOT_TESTED', source, checkedAt, httpStatus: null, latencyMs: 0,
    sampleCount: 0, parseSuccess: false, error: null, notes: `${provider}: canlı parse testi yapılmadı`,
  }));
}
