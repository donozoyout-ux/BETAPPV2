import type { MatchStatistics, NormalizedMatch } from '../domain/types.js';

export type HistoricalDataQuality = 'COMPLETE' | 'PARTIAL' | 'LIMITED' | 'POOR';
export type HistoricalProviderId = 'fotmob' | 'football-data-csv' | 'openfootball' | 'statbunker' | 'soccerstats' | 'adamchoi' | 'footystats';
export type HistoricalProviderStatus = 'PRODUCTION_ELIGIBLE' | 'MANUAL_REVIEW_REQUIRED' | 'DISABLED_BY_POLICY' | 'DISABLED_PAID_API';

export type HistoricalMatch = {
  match: NormalizedMatch;
  statistics: MatchStatistics;
  refereeExternalId: string | null;
  fetchedAt: Date;
  rawPayloadHash: string;
  dataQuality: HistoricalDataQuality;
  normalizationVersion: 'HISTORICAL_V1';
};

export type HistoricalBackfillProgress = {
  requested: number; received: number; inserted: number; updated: number; duplicates: number; errors: number;
  cursor: Record<string, unknown>;
};
