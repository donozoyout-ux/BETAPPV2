import type { MatchStatistics, NormalizedMatch, ProviderHealth } from '../domain/types.js';

export type FixtureQuery = { date: Date };

export interface FootballDataProvider {
  readonly name: string;
  getFixtures(query: FixtureQuery): Promise<NormalizedMatch[]>;
  getMatchStatistics(matchProviderExternalId: string): Promise<MatchStatistics>;
  healthCheck(): Promise<ProviderHealth>;
}
